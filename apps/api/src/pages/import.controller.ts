import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { markdownToDocument } from "@angy/blocks";
import { createPage, getEffectiveSpaceLevel, getPrisma, type Prisma } from "@angy/db";
import {
  importMarkdownSchema,
  JOB_PROJECTION_INIT,
  ok,
  satisfies,
  type ApiOk,
  type ImportMarkdownDto,
  type ImportResultDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { projectionsQueue } from "../queue";
import { ZodValidationPipe } from "../zod.pipe";

/**
 * Markdown import (ADR 0005, the one-directional *in* flow) — and the engine a
 * Confluence/Notion importer needs, which is why it takes a generic bundle of
 * files rather than one vendor's export format.
 *
 * Every imported page is a **fresh** page with a fresh Y.Doc, built through the
 * same `createPage(documentJson)` → `initYdoc` path a blank or templated page
 * takes. Import never merges into an existing document: Markdown carries no
 * CRDT tombstones, so merging would discard the history concurrent editing
 * depends on.
 *
 * The API is CommonJS and must never construct a Y.Doc (CLAUDE.md gotcha), and
 * it does not need to — `markdownToDocument` returns plain JSON and the worker
 * turns it into a document.
 */
@Controller()
@UseGuards(SessionGuard)
export class ImportController {
  @Post("spaces/:spaceId/import")
  async importMarkdown(
    @Param("spaceId") spaceId: string,
    @Body(new ZodValidationPipe(importMarkdownSchema)) body: ImportMarkdownDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<ImportResultDto>> {
    const prisma = getPrisma();
    const id = BigInt(spaceId);
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, id);
    if (!satisfies(level, "EDIT")) {
      throw new ForbiddenException("You need edit access to import into this space");
    }

    // Shallowest first, so a folder's page exists before its children need it
    // as a parent. Without this a nested file would create its own ancestors
    // and then collide with the real ones later in the bundle.
    const files = [...body.files].sort(
      (a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path),
    );

    const taken = new Set(
      (await prisma.page.findMany({ where: { spaceId: id }, select: { slug: true } })).map(
        (p) => p.slug,
      ),
    );
    /** Folder path → the page standing for it, so siblings share one parent. */
    const folders = new Map<string, string>();
    const created: { id: string; title: string; path: string }[] = [];
    const skipped: { path: string; reason: string }[] = [];

    for (const file of files) {
      const segments = normalisePath(file.path);
      if (segments.length === 0) {
        skipped.push({ path: file.path, reason: "Not a usable path" });
        continue;
      }

      const parsed = markdownToDocument(file.markdown);
      const name = segments.at(-1)!.replace(/\.mdx?$/i, "");
      const title = (parsed.title ?? titleFromFilename(name)).slice(0, 200);

      // An index file *is* its folder's page, so it hangs off the folder
      // above — asking for its own folder would be asking to be its own
      // parent, and the page it needs does not exist yet by definition.
      const dir = segments.slice(0, -1);
      const parentPath = (isIndex(name) ? dir.slice(0, -1) : dir).join("/");
      const parentId = parentPath === "" ? null : (folders.get(parentPath) ?? null);
      if (parentPath !== "" && parentId === null) {
        // The bundle referenced a directory no file stands for. Import at the
        // root rather than dropping it: a misplaced page beats a lost one.
        skipped.push({ path: file.path, reason: "Parent folder had no page; imported at root" });
      }

      const page = await createPage(prisma, {
        spaceId: id,
        parentId,
        title,
        slug: uniqueSlug(title, taken),
        createdBy: req.user.id,
        documentJson: parsed.doc as Prisma.InputJsonValue,
      });
      await projectionsQueue().add(JOB_PROJECTION_INIT, { pageId: page.id });

      created.push({ id: page.id, title, path: file.path });
      // What this page stands in for, so later files can nest under it: an
      // index file represents its own folder; any other file represents a
      // folder of its own name, which is how Notion exports pair `Page.md`
      // with a sibling `Page/` directory of children.
      const folderPath = isIndex(name) ? dir.join("/") : segments.join("/").replace(/\.mdx?$/i, "");
      if (folderPath) folders.set(folderPath, page.id);
    }

    return ok({ created, skipped });
  }
}

const depthOf = (path: string) => normalisePath(path).length;

/** Reject traversal and empty segments — a path here only names a hierarchy. */
function normalisePath(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const isIndex = (name: string) => /^(index|readme)$/i.test(name);

function titleFromFilename(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
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
