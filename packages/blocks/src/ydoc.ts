import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { baseExtensions } from "./extensions.js";
import { EMPTY_DOCUMENT } from "./render.js";

/**
 * y-prosemirror stores the ProseMirror fragment under this Y.Doc key. It must
 * match the Tiptap Collaboration extension's default field — one Y.Doc = one
 * page, always (hard rule 4).
 */
export const YDOC_FIELD = "default";

/**
 * The page title is a collaborative Y.Text living in the *same* Y.Doc as the
 * body — one Y.Doc = one page (hard rule 4), so the title travels with the
 * content through sync, persistence, revisions, and restore.
 */
export const TITLE_FIELD = "title";

/** Read the collaborative title. Empty means the doc predates the field. */
export function ydocTitle(ydoc: Y.Doc): string {
  return ydoc.getText(TITLE_FIELD).toString();
}

/**
 * Rewrite a Y.Text to `next` by editing only what changed. A wholesale
 * delete-and-reinsert would clobber a concurrent editor's keystrokes and jump
 * everyone's caret to the end; matching the common prefix and suffix keeps
 * simultaneous edits to other parts of the string intact.
 */
export function applyTextDiff(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;

  const max = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < max && current[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteCount = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  const edit = () => {
    if (deleteCount > 0) text.delete(prefix, deleteCount);
    if (inserted) text.insert(prefix, inserted);
  };
  // One transaction so remote peers see the replacement, not an empty flicker.
  if (text.doc) text.doc.transact(edit);
  else edit();
}

/** Build a fresh Y.Doc from ProseMirror JSON — the ONLY place docs are born from JSON. */
export function createYdocFromJson(doc: JSONContent | null | undefined): Y.Doc {
  return prosemirrorJSONToYDoc(getSchema(baseExtensions()), doc ?? EMPTY_DOCUMENT, YDOC_FIELD);
}

/** Project a Y.Doc back to ProseMirror JSON (for rendered_html / text_extract). */
export function ydocToJson(ydoc: Y.Doc): JSONContent {
  return yDocToProsemirrorJSON(ydoc, YDOC_FIELD) as JSONContent;
}

/**
 * Materialize persisted update bytes as ProseMirror JSON. The Y.Doc lives and
 * dies inside this module — CJS consumers (the API) must never construct
 * Y.Docs themselves: mixing the CJS and ESM yjs builds creates two instances
 * and breaks y-prosemirror (CLAUDE.md gotcha: enforce a single yjs copy).
 */
export function updateToJson(update: Uint8Array): JSONContent {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, update);
  const json = ydocToJson(ydoc);
  ydoc.destroy();
  return json;
}
