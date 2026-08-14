import { createHash, randomUUID } from "node:crypto";
import {
  documentUrls,
  markdownToDocument,
  rewriteDocumentUrls,
  type JSONContent,
} from "@angy/blocks";
import { createPage, type Prisma, type PrismaClient, type SpaceVisibility } from "@angy/db";
import {
  JOB_ATTACHMENT_REINDEX,
  JOB_PROJECTION_INIT,
  JOB_THUMBNAIL,
  type ImportResultDto,
} from "@angy/shared";
import { bareMediaUrl, putMediaObject } from "../media";
import { maintenanceQueue, projectionsQueue } from "../queue";
import { resolveArchiveRef, stripExportId, type ArchiveMedia, type ArchiveMarkdown } from "./archive";

/**
 * The one Markdown→page path (ADR 0005). A JSON bundle and an unpacked export
 * archive are the same import with different amounts known about the media, so
 * they run through this and not through two loops that drift apart.
 *
 * Two phases, and the split is load-bearing. **Plan** decides every page's id,
 * title, slug and parent without touching the database; **apply** rewrites each
 * document against that plan and writes it. A one-pass import cannot rewrite a
 * link to a page it has not created yet — and half an export's links point
 * forward — so the ids have to be known before the first write.
 *
 * Every page is created through `createPage(documentJson)` → `initYdoc`, the
 * same path a blank or templated page takes. Import never merges into an
 * existing document: Markdown carries no CRDT tombstones and merging would
 * discard the history concurrent editing depends on.
 */

export interface ImportRequest {
  spaceId: bigint;
  spaceVisibility: SpaceVisibility;
  userId: bigint;
  files: ArchiveMarkdown[];
  /** Archive media by path; absent for a JSON bundle, which carries none. */
  media?: Map<string, ArchiveMedia>;
  /** Anything the caller already refused to unpack, carried into the result. */
  skipped?: { path: string; reason: string }[];
}

interface PlannedPage {
  id: string;
  /** Archive path this page stands for — a file, or a folder with no file. */
  path: string;
  parentId: string | null;
  title: string;
  slug: string;
  /** null for a folder that no file stands for: a heading with no body. */
  doc: JSONContent | null;
}

interface UploadedMedia {
  s3Key: string;
  docSrc: string;
  sha256: string;
  media: ArchiveMedia;
}

export async function importBundle(
  prisma: PrismaClient,
  request: ImportRequest,
): Promise<ImportResultDto> {
  const skipped = [...(request.skipped ?? [])];
  const taken = new Set(
    (
      await prisma.page.findMany({ where: { spaceId: request.spaceId }, select: { slug: true } })
    ).map((page) => page.slug),
  );

  const plan = planPages(request.files, taken);
  skipped.push(...plan.skipped);

  const media = request.media ?? new Map<string, ArchiveMedia>();
  const uploads = new Map<string, UploadedMedia>();
  const created: ImportResultDto["created"] = [];
  let attachments = 0;

  for (const page of plan.pages) {
    const document = page.doc ?? { type: "doc", content: [{ type: "paragraph" }] };
    const used = new Set<string>();

    // Media first: rewriting is synchronous, uploading is not, so every image
    // this page references is resolved and stored before the document is
    // touched. One upload per file however many pages point at it — the key is
    // its sha256, so a second put would write the same bytes to the same place.
    for (const ref of documentUrls(document)) {
      if (ref.kind !== "image") continue;
      const path = resolveArchiveRef(page.path, ref.url);
      if (!path) continue; // absolute URL: already points somewhere real
      const file = media.get(path);
      if (!file) {
        skipped.push({ path, reason: `Image referenced by "${page.title}" is not in the archive` });
        continue;
      }
      if (!uploads.has(path)) {
        try {
          uploads.set(path, await upload(file, request.spaceVisibility));
        } catch {
          // One unstorable file must not cost the import its receipt: the
          // pages already created would be left with nothing saying so.
          skipped.push({ path, reason: "Could not be stored — the page kept the reference" });
          continue;
        }
      }
      used.add(path);
    }

    const rewritten = rewriteDocumentUrls(document, (url, kind) => {
      const path = resolveArchiveRef(page.path, url);
      if (!path) return null;
      if (kind === "image") return uploads.get(path)?.docSrc ?? null;
      const target = plan.pageIdByPath.get(path);
      // `/p/{id}`, never `/s/{key}/{id}`: a space key baked into a link goes
      // stale the moment the page moves (CLAUDE.md).
      return target ? `/p/${target}` : null;
    });

    await createPage(prisma, {
      id: page.id,
      spaceId: request.spaceId,
      parentId: page.parentId,
      title: page.title,
      slug: page.slug,
      createdBy: request.userId,
      documentJson: rewritten as Prisma.InputJsonValue,
    });
    await projectionsQueue().add(JOB_PROJECTION_INIT, { pageId: page.id });

    for (const path of used) {
      await attach(prisma, uploads.get(path)!, page.id, request.userId);
      attachments++;
    }
    created.push({ id: page.id, title: page.title, path: page.path });
  }

  // Media nobody pointed at is left behind, and saying so is the difference
  // between an import that lost a file and one that told you it did.
  for (const path of media.keys()) {
    if (!uploads.has(path)) skipped.push({ path, reason: "Not referenced by any imported page" });
  }

  return { created, skipped, attachments };
}

/**
 * Decide the whole page tree before writing any of it.
 *
 * Pure, so the rules that make an export legible — an `index.md` *is* its
 * folder's page, a bare `Page.md` stands in for a sibling `Page/` directory,
 * a folder no file stands for still becomes a page rather than dropping its
 * children at the space root — are testable without a database.
 */
export function planPages(
  files: ArchiveMarkdown[],
  taken: Set<string> = new Set(),
): {
  pages: PlannedPage[];
  /** File path → page id, for resolving the links between them. */
  pageIdByPath: Map<string, string>;
  skipped: { path: string; reason: string }[];
} {
  const pages: PlannedPage[] = [];
  const pageIdByPath = new Map<string, string>();
  const folders = new Map<string, string>();
  const skipped: { path: string; reason: string }[] = [];

  /** Synthesize the chain down to `path`, ancestors first, so parents exist. */
  const ensureFolder = (path: string): string | null => {
    if (path === "") return null;
    const existing = folders.get(path);
    if (existing) return existing;

    const parentId = ensureFolder(parentOf(path));
    const title = titleFrom(path.split("/").pop() ?? path);
    const page: PlannedPage = {
      id: randomUUID(),
      path,
      parentId,
      title,
      slug: uniqueSlug(title, taken),
      doc: null,
    };
    pages.push(page);
    folders.set(path, page.id);
    pageIdByPath.set(path, page.id);
    return page.id;
  };

  // Shallowest first: a folder is claimed by its own file before anything
  // nested under it asks for a parent, so no page is invented twice.
  const sorted = [...files].sort(
    (a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path),
  );

  for (const file of sorted) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) {
      skipped.push({ path: file.path, reason: "Not a usable path" });
      continue;
    }
    if (pageIdByPath.has(file.path)) {
      skipped.push({ path: file.path, reason: "Duplicate path in the bundle" });
      continue;
    }

    const name = segments.at(-1)!.replace(/\.(md|mdx|markdown)$/i, "");
    const dir = segments.slice(0, -1).join("/");
    // What this file stands in for, so later files can nest under it: an index
    // file represents its own folder; any other file represents a folder of
    // its own name, which is how Notion pairs `Page.md` with a `Page/` of
    // children.
    const standsFor = isIndex(name) ? dir : [dir, name].filter(Boolean).join("/");
    // An index file whose folder another file already claims is just a child
    // of it — asking to be its own parent's page twice is the one case where
    // "index" cannot mean what it usually means.
    const claimed = standsFor !== "" && folders.has(standsFor);
    const parentPath = isIndex(name) && !claimed ? parentOf(dir) : dir;

    const parsed = markdownToDocument(file.markdown);
    const title = (parsed.title ?? titleFrom(name)).slice(0, 200);
    const page: PlannedPage = {
      id: randomUUID(),
      path: file.path,
      parentId: ensureFolder(parentPath),
      title,
      slug: uniqueSlug(title, taken),
      doc: parsed.doc,
    };
    pages.push(page);
    pageIdByPath.set(file.path, page.id);
    if (standsFor && !claimed) {
      folders.set(standsFor, page.id);
      // A link may name the folder rather than the file standing for it.
      if (!pageIdByPath.has(standsFor)) pageIdByPath.set(standsFor, page.id);
    }
  }

  return { pages, pageIdByPath, skipped };
}

async function upload(media: ArchiveMedia, visibility: SpaceVisibility): Promise<UploadedMedia> {
  const sha256 = createHash("sha256").update(media.bytes).digest("hex");
  // Access class is a storage prefix: only media/* has anonymous read, and
  // media-private/* is reachable exclusively through signed URLs (ADR 0007).
  const isPrivate = visibility === "PRIVATE";
  const s3Key = `${isPrivate ? "media-private" : "media"}/${sha256}`;
  await putMediaObject(s3Key, media.bytes, media.mimeType);
  return {
    s3Key,
    sha256,
    media,
    // The document stores the stable form, never an expiring signed URL.
    docSrc: isPrivate ? `/media/${s3Key}` : bareMediaUrl(s3Key),
  };
}

async function attach(
  prisma: PrismaClient,
  uploaded: UploadedMedia,
  pageId: string,
  userId: bigint,
): Promise<void> {
  const attachment = await prisma.attachment.create({
    data: {
      pageId,
      fileName: uploaded.media.fileName,
      sha256: uploaded.sha256,
      mimeType: uploaded.media.mimeType,
      sizeBytes: BigInt(uploaded.media.bytes.length),
      s3Key: uploaded.s3Key,
      uploadedBy: userId,
    },
  });
  if (uploaded.media.mimeType.startsWith("image/")) {
    await maintenanceQueue().add(JOB_THUMBNAIL, { attachmentId: attachment.id.toString() });
  }
  await maintenanceQueue().add(JOB_ATTACHMENT_REINDEX, {
    attachmentId: attachment.id.toString(),
  });
}

const depthOf = (path: string) => path.split("/").filter(Boolean).length;
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const isIndex = (name: string) => /^(index|readme)$/i.test(name);

function titleFrom(name: string): string {
  const words = stripExportId(name.replace(/\.(md|mdx|markdown)$/i, ""))
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Untitled";
}

function uniqueSlug(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .slice(0, 60) || "page";
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  taken.add(slug);
  return slug;
}
