import { unzipSync } from "fflate";

/**
 * Export-archive unpacking — the front half of the Confluence/Notion importer
 * (V2 H2). It turns a `.zip` into exactly the generic `{path, markdown}` bundle
 * `POST /spaces/:id/import` already takes, plus the media sitting beside it.
 *
 * Deliberately vendor-agnostic: the server learns *one* shape, and a Notion or
 * Confluence export becomes that shape here. The only vendor-specific thing in
 * this file is `stripExportId` — Notion suffixes every file and folder with the
 * page's 32-hex id, and carrying that into a page title is unreadable.
 *
 * Everything is bounded before it is inflated. A zip declares its uncompressed
 * size in each entry header, so the filter can refuse an entry — or the rest of
 * the archive — without ever allocating it. Without that, a 1 MB upload can ask
 * the API for gigabytes (a zip bomb), and the API is the process that must not
 * fall over.
 */

/** Matches the per-file attachment cap: a bigger entry could not be uploaded anyway. */
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
/** Total inflated bytes held in memory for one import. */
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
/** Parity with `importMarkdownSchema` — one request, one bounded write. */
export const MAX_MARKDOWN_FILES = 200;
/** Notion splits a large export into `Part-1.zip`, … inside the archive. */
const MAX_NESTED_DEPTH = 1;

/** Stored (0) and deflate (8) are the methods fflate can inflate. */
const SUPPORTED_COMPRESSION = new Set([0, 8]);

const MARKDOWN_EXTENSIONS = /\.(md|mdx|markdown)$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  csv: "text/csv",
  txt: "text/plain",
  json: "application/json",
};

export interface ArchiveMarkdown {
  /** Normalised, slash-separated, relative to the archive root. */
  path: string;
  markdown: string;
}

export interface ArchiveMedia {
  path: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface UnpackedArchive {
  files: ArchiveMarkdown[];
  /** Keyed by normalised path — the form a Markdown reference resolves to. */
  media: Map<string, ArchiveMedia>;
  /** Never a silent drop: everything the archive held and this did not take. */
  skipped: { path: string; reason: string }[];
}

export function unpackArchive(zip: Uint8Array): UnpackedArchive {
  const out: UnpackedArchive = { files: [], media: new Map(), skipped: [] };
  const budget = { remaining: MAX_TOTAL_BYTES };
  read(zip, out, budget, 0);

  // Sorted so the bundle is deterministic regardless of the order entries
  // happen to sit in the central directory.
  out.files.sort((a, b) => a.path.localeCompare(b.path));
  if (out.files.length > MAX_MARKDOWN_FILES) {
    for (const extra of out.files.splice(MAX_MARKDOWN_FILES)) {
      out.skipped.push({
        path: extra.path,
        reason: `Over the ${MAX_MARKDOWN_FILES}-page limit for one import`,
      });
    }
  }
  return out;
}

function read(
  data: Uint8Array,
  out: UnpackedArchive,
  budget: { remaining: number },
  depth: number,
): void {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, { filter: (file) => keep(file, out, budget, depth) });
  } catch {
    // A truncated or encrypted archive: one message about the archive beats a
    // 500, because the person who picked the file is the one who can fix it.
    out.skipped.push({ path: "", reason: "The archive could not be read" });
    return;
  }

  for (const [name, bytes] of Object.entries(entries)) {
    const path = normaliseArchivePath(name);
    if (!path) continue;

    if (/\.zip$/i.test(path)) {
      // Flattened, not nested under a page named after the part file: the
      // parts of a split export are halves of one tree, not two sections.
      read(bytes, out, budget, depth + 1);
      continue;
    }
    if (MARKDOWN_EXTENSIONS.test(path)) {
      out.files.push({ path, markdown: decodeText(bytes) });
      continue;
    }
    out.media.set(path, {
      path,
      fileName: path.split("/").pop() ?? path,
      bytes,
      mimeType: mimeTypeOf(path),
    });
  }
}

function keep(
  file: { name: string; originalSize: number; compression: number },
  out: UnpackedArchive,
  budget: { remaining: number },
  depth: number,
): boolean {
  if (file.name.endsWith("/")) return false; // directory entry
  const path = normaliseArchivePath(file.name);
  if (!path || isJunk(path)) return false;

  if (/\.zip$/i.test(path) && depth >= MAX_NESTED_DEPTH) {
    out.skipped.push({ path, reason: "Archive nested too deeply to unpack" });
    return false;
  }
  if (/\.html?$/i.test(path)) {
    out.skipped.push({ path, reason: "HTML is not importable — re-export as Markdown" });
    return false;
  }
  if (!SUPPORTED_COMPRESSION.has(file.compression)) {
    out.skipped.push({ path, reason: "Compressed with a method this importer cannot read" });
    return false;
  }
  if (file.originalSize > MAX_ENTRY_BYTES) {
    out.skipped.push({ path, reason: `Larger than ${MAX_ENTRY_BYTES / 1024 / 1024} MB` });
    return false;
  }
  if (file.originalSize > budget.remaining) {
    out.skipped.push({ path, reason: "The archive unpacks to more than one import can hold" });
    return false;
  }
  budget.remaining -= file.originalSize;
  return true;
}

/** Editor and OS debris. Reported nowhere, because nobody meant to import it. */
function isJunk(path: string): boolean {
  return path
    .split("/")
    .some(
      (segment) =>
        segment.startsWith(".") || segment === "__MACOSX" || /^(Thumbs\.db|desktop\.ini)$/i.test(segment),
    );
}

/**
 * A path as this importer addresses it: slash-separated, relative, no `.` or
 * `..`. Traversal is dropped rather than rejected — a path here names a place
 * in a hierarchy, and there is no filesystem underneath for it to escape into.
 */
export function normaliseArchivePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .join("/");
}

/**
 * Resolve a Markdown reference against the file that wrote it.
 *
 * References inside an export are relative and percent-encoded (`Getting
 * Started%20abc/diagram.png`), and may carry a fragment or query that names
 * nothing in the archive. Absolute URLs resolve to null: they already point
 * somewhere real and rewriting them would break them.
 */
export function resolveArchiveRef(fromPath: string, ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("//")) return null;

  const withoutFragment = trimmed.split(/[?#]/)[0] ?? "";
  if (!withoutFragment) return null;

  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // A stray "%" is not an encoding — take the reference literally.
  }

  const base = decoded.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  const segments = [...base];
  for (const segment of decoded.split("/")) {
    const part = segment.trim();
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/") || null;
}

/** `Getting started 24d0e0e5f5e2809ab5a5cdb6ca1ea1e0` → `Getting started`. */
export function stripExportId(name: string): string {
  return name.replace(/[\s_-]+[0-9a-f]{32}$/i, "").trim() || name;
}

function mimeTypeOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function decodeText(bytes: Uint8Array): string {
  // A leading BOM would otherwise land inside the first heading's text.
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}
