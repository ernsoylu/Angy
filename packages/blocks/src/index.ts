/**
 * Static block-type registry (compile-time — runtime plugin manager is V2).
 */
export const V1_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "codeBlock",
  "image",
  "table",
  "callout",
  "divider",
  "blockquote",
] as const;

export type BlockType = (typeof V1_BLOCK_TYPES)[number];

export { Callout, CALLOUT_TONES, type CalloutTone } from "./callout.js";
export { diffDocuments, diffWords, type DiffBlock, type WordDiffPart } from "./diff.js";
export { baseExtensions, editorExtensions } from "./extensions.js";
export { EMPTY_DOCUMENT, extractText, renderDocumentToHtml } from "./render.js";
export { applyDocJson } from "./restore.js";
export { createYdocFromJson, updateToJson, ydocToJson, YDOC_FIELD } from "./ydoc.js";
export type { JSONContent } from "@tiptap/core";
