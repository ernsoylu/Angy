import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { extractText, renderDocumentToHtml } from "./render.js";

const doc: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "The Y.Doc lifecycle" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Readers are served " },
        { type: "text", marks: [{ type: "bold" }], text: "pre-rendered HTML" },
        { type: "text", text: "." },
      ],
    },
    {
      type: "callout",
      attrs: { tone: "hardRule", title: "Hard rule 1" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Never store Yjs blobs in Postgres." }] },
      ],
    },
    { type: "codeBlock", content: [{ type: "text", text: "encodeStateAsUpdate(doc)" }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "One Y.Doc per page" }] }],
        },
      ],
    },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Store" }] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "S3" }] }] },
          ],
        },
      ],
    },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted." }] }] },
    { type: "image", attrs: { src: "https://cdn.example/x.png", alt: "diagram" } },
  ],
};

describe("renderDocumentToHtml", () => {
  const html = renderDocumentToHtml(doc);

  it("renders every V1 block type", () => {
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>pre-rendered HTML</strong>");
    expect(html).toContain("<pre");
    expect(html).toContain("<ul");
    expect(html).toContain("<hr");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<blockquote");
    expect(html).toContain('<img src="https://cdn.example/x.png"');
  });

  it("renders callouts with tone class and title", () => {
    expect(html).toContain('class="callout callout-hardRule"');
    expect(html).toContain('<div class="callout-title">Hard rule 1</div>');
    expect(html).toContain("Never store Yjs blobs in Postgres.");
  });

  it("is deterministic (idempotent projections)", () => {
    expect(renderDocumentToHtml(doc)).toBe(html);
  });
});

describe("extractText", () => {
  it("flattens text including callout titles", () => {
    const text = extractText(doc);
    expect(text).toContain("The Y.Doc lifecycle");
    expect(text).toContain("Readers are served pre-rendered HTML .");
    expect(text).toContain("Hard rule 1");
    expect(text).toContain("Store S3");
    expect(text).not.toContain("<");
  });
});
