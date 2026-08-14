import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { documentUrls, rewriteDocumentUrls } from "./doc-urls.js";

/**
 * Rewriting the URLs an imported document arrived with (ADR 0005). The two
 * properties that matter: nothing the callback declines is touched, and a
 * `pageLink` — which addresses a page by id — is never mistaken for a URL.
 */

const doc: JSONContent = {
  type: "doc",
  content: [
    { type: "image", attrs: { src: "diagram.png", alt: "Diagram" } },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        {
          type: "text",
          text: "onboarding",
          marks: [{ type: "link", attrs: { href: "Onboarding.md" } }],
        },
        {
          type: "text",
          text: " or the docs",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    },
    { type: "pageLink", attrs: { pageId: "0e4f", title: "Team" } },
  ],
};

describe("documentUrls", () => {
  it("reads image sources and link hrefs, in document order", () => {
    expect(documentUrls(doc)).toEqual([
      { url: "diagram.png", kind: "image" },
      { url: "Onboarding.md", kind: "link" },
      { url: "https://example.com", kind: "link" },
    ]);
  });
});

describe("rewriteDocumentUrls", () => {
  it("replaces what the caller resolves and leaves the rest as written", () => {
    const rewritten = rewriteDocumentUrls(doc, (url) =>
      url === "diagram.png" ? "/media/media/abc" : url === "Onboarding.md" ? "/p/9c1" : null,
    );

    expect(rewritten.content![0]!.attrs!.src).toBe("/media/media/abc");
    const paragraph = rewritten.content![1]!.content!;
    expect(paragraph[1]!.marks![0]!.attrs!.href).toBe("/p/9c1");
    // Declined: an absolute URL already points somewhere real.
    expect(paragraph[2]!.marks![0]!.attrs!.href).toBe("https://example.com");
  });

  it("leaves a page link alone — it has an id, not a URL", () => {
    const rewritten = rewriteDocumentUrls(doc, () => "/rewritten");
    expect(rewritten.content![2]).toEqual(doc.content![2]);
  });

  it("does not mutate the document it was given", () => {
    rewriteDocumentUrls(doc, () => "/rewritten");
    expect(doc.content![0]!.attrs!.src).toBe("diagram.png");
  });
});
