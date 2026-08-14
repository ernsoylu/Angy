import type { JSONContent } from "@tiptap/core";

/**
 * The external URLs a document carries — image sources and link hrefs — read
 * and rewritten in one place.
 *
 * This exists for import (ADR 0005). A Markdown file inside an export archive
 * points at its siblings: `![](Page%20abc/diagram.png)` for media, and
 * `[Onboarding](Onboarding%20abc.md)` for the page next to it. Both are
 * relative to a directory that stops existing the moment the file becomes a
 * page, so an import that copies them verbatim produces a wiki of broken
 * images and dead links.
 *
 * Rewriting lives here rather than in the importer because it is document
 * surgery, and the schema is defined in this package (isomorphic-block
 * invariant). `pageLink` nodes are deliberately untouched: they address a page
 * by id and have no URL to fix.
 */

export type DocUrlKind = "image" | "link";

export interface DocUrl {
  url: string;
  kind: DocUrlKind;
}

/**
 * Rewrite every URL in a document. The callback returns a replacement, or
 * `null` to leave that URL as the author wrote it — which is the difference
 * between "this pointed at a file in the archive" and "this pointed at the
 * public internet", and the caller is the only one who can tell them apart.
 */
export function rewriteDocumentUrls(
  doc: JSONContent,
  rewrite: (url: string, kind: DocUrlKind) => string | null,
): JSONContent {
  return mapNode(doc, rewrite);
}

/** Every URL in a document, in document order. Duplicates are kept. */
export function documentUrls(doc: JSONContent): DocUrl[] {
  const urls: DocUrl[] = [];
  rewriteDocumentUrls(doc, (url, kind) => {
    urls.push({ url, kind });
    return null;
  });
  return urls;
}

function mapNode(
  node: JSONContent,
  rewrite: (url: string, kind: DocUrlKind) => string | null,
): JSONContent {
  let next = node;

  if (node.type === "image" && typeof node.attrs?.src === "string") {
    const replaced = rewrite(node.attrs.src, "image");
    if (replaced !== null) next = { ...next, attrs: { ...next.attrs, src: replaced } };
  }

  // A link is a mark on text, not a node — so the URL of "the same" link is
  // repeated on every differently-styled run inside it. Rewriting per mark is
  // what keeps a half-bold link from ending up half-rewritten.
  if (node.marks?.length) {
    let changed = false;
    const marks = node.marks.map((mark) => {
      if (mark.type !== "link" || typeof mark.attrs?.href !== "string") return mark;
      const replaced = rewrite(mark.attrs.href, "link");
      if (replaced === null) return mark;
      changed = true;
      return { ...mark, attrs: { ...mark.attrs, href: replaced } };
    });
    if (changed) next = { ...next, marks };
  }

  if (node.content) {
    next = { ...next, content: node.content.map((child) => mapNode(child, rewrite)) };
  }
  return next;
}
