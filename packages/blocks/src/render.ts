import type { JSONContent } from "@tiptap/core";
import { renderToHTMLString } from "@tiptap/static-renderer";
import { baseExtensions } from "./extensions.js";

/** Render ProseMirror JSON to the HTML served on the SSR read path. */
export function renderDocumentToHtml(doc: JSONContent): string {
  return renderToHTMLString({ extensions: baseExtensions(), content: doc });
}

/** Flatten a document to plain text for the search index (text_extract). */
export function extractText(doc: JSONContent): string {
  const parts: string[] = [];

  function walk(node: JSONContent): void {
    if (node.type === "text" && node.text) parts.push(node.text);
    // Atoms carry their text in an attribute rather than a child text node —
    // a page link's title, a mention's name. Search would otherwise never
    // match the one word a reader remembers about the page.
    if (typeof node.attrs?.title === "string") parts.push(node.attrs.title);
    if (typeof node.attrs?.label === "string") parts.push(node.attrs.label);
    for (const child of node.content ?? []) walk(child);
  }

  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export const EMPTY_DOCUMENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
