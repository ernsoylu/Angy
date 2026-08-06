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
  "pageLink",
] as const;

export type BlockType = (typeof V1_BLOCK_TYPES)[number];

export { Callout, CALLOUT_TONES, type CalloutTone } from "./callout.js";
export { PageLink } from "./page-link.js";
export { diffDocuments, diffWords, type DiffBlock, type WordDiffPart } from "./diff.js";
export { baseExtensions, editorExtensions } from "./extensions.js";
export { EMPTY_DOCUMENT, extractText, renderDocumentToHtml } from "./render.js";
export { applyDocJson } from "./restore.js";
export {
  applyTextDiff,
  createYdocFromJson,
  TITLE_FIELD,
  updateToJson,
  ydocTitle,
  ydocToJson,
  YDOC_FIELD,
} from "./ydoc.js";
export type { JSONContent } from "@tiptap/core";

// The extension packages augment Tiptap's ChainedCommands from their own .d.ts
// files. Re-exporting them here carries `setLink`, `addRowBefore`, … to anyone
// consuming this package, so editor UI never has to depend on the extension
// packages directly (isomorphic-block invariant: schema lives here alone).
export type {} from "@tiptap/extension-link";
export type {} from "@tiptap/extension-table";
