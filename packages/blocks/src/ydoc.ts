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
