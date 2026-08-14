import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { documentToMarkdown } from "./markdown.js";

const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const t = (text: string, ...marks: string[]): JSONContent => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

describe("documentToMarkdown", () => {
  it("puts the page title in an H1, since the body does not carry it", () => {
    // The title lives on the page row and in the Y.Doc's `title` field, so an
    // export without this loses the page's name entirely.
    expect(documentToMarkdown(doc(p(t("Body."))), "Architecture")).toBe(
      "# Architecture\n\nBody.\n",
    );
  });

  it("renders headings, quotes and rules", () => {
    const md = documentToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Section")] },
        { type: "blockquote", content: [p(t("Quoted."))] },
        { type: "horizontalRule" },
      ),
    );
    expect(md).toBe("## Section\n\n> Quoted.\n\n---\n");
  });

  it("nests marks innermost-first", () => {
    expect(documentToMarkdown(doc(p(t("both", "italic", "bold"))))).toBe("***both***\n");
  });

  it("does not nest marks inside a code span", () => {
    // Markdown has no way to bold part of `code`; emitting ** inside would
    // print the asterisks literally.
    expect(documentToMarkdown(doc(p(t("x || y", "code", "bold"))))).toBe("`x || y`\n");
  });

  it("leaves code-span content unescaped", () => {
    expect(documentToMarkdown(doc(p(t("a*b_c", "code"))))).toBe("`a*b_c`\n");
  });

  it("escapes characters that would start a construct", () => {
    expect(documentToMarkdown(doc(p(t("a*b_c[d]"))))).toBe("a\\*b\\_c\\[d\\]\n");
  });

  it("writes links from the mark's href", () => {
    expect(
      documentToMarkdown(
        doc(p({ type: "text", text: "docs", marks: [{ type: "link", attrs: { href: "/x" } }] })),
      ),
    ).toBe("[docs](/x)\n");
  });

  it("fences code blocks with their language", () => {
    const md = documentToMarkdown(
      doc({ type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;")] }),
    );
    expect(md).toBe("```ts\nconst a = 1;\n```\n");
  });

  it("numbers ordered lists from their start attribute", () => {
    const md = documentToMarkdown(
      doc({
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [p(t("three"))] },
          { type: "listItem", content: [p(t("four"))] },
        ],
      }),
    );
    expect(md).toBe("3. three\n4. four\n");
  });

  it("indents a nested list under its parent item", () => {
    const md = documentToMarkdown(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(t("parent")),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [p(t("child"))] }],
              },
            ],
          },
        ],
      }),
    );
    // The child must be indented, or it reads as a sibling on re-import.
    expect(md).toBe("- parent\n\n  - child\n");
  });

  it("writes task lists as GitHub checkboxes", () => {
    const md = documentToMarkdown(
      doc({
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: false }, content: [p(t("open"))] },
          { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
        ],
      }),
    );
    expect(md).toBe("- [ ] open\n- [x] done\n");
  });

  it("renders a table with a header separator", () => {
    const cell = (text: string): JSONContent => ({
      type: "tableCell",
      content: [p(t(text))],
    });
    const md = documentToMarkdown(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("a"), cell("b")] },
          { type: "tableRow", content: [cell("1"), cell("2")] },
        ],
      }),
    );
    expect(md).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  });

  it("pads a short row rather than emitting a ragged table", () => {
    const cell = (text: string): JSONContent => ({ type: "tableCell", content: [p(t(text))] });
    const md = documentToMarkdown(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("a"), cell("b")] },
          { type: "tableRow", content: [cell("1")] },
        ],
      }),
    );
    expect(md.trim().split("\n").at(-1)).toBe("| 1 |  |");
  });

  it("degrades a callout to a quote, keeping its title and words", () => {
    const md = documentToMarkdown(
      doc({
        type: "callout",
        attrs: { tone: "hardRule", title: "Hard rule 1" },
        content: [p(t("Never store Yjs blobs in Postgres."))],
      }),
    );
    expect(md).toBe("> **Hard rule 1**\n>\n> Never store Yjs blobs in Postgres.\n");
  });

  it("writes a page link as a permalink, and a mention as its name", () => {
    const md = documentToMarkdown(
      doc(
        { type: "pageLink", attrs: { pageId: "abc", title: "Runbook" } },
        p(t("ask "), { type: "mention", attrs: { userId: "7", label: "Ada" } }),
      ),
      undefined,
      { pageLinkBase: "https://angy.example/p" },
    );
    expect(md).toBe("[Runbook](https://angy.example/p/abc)\n\nask @Ada\n");
  });

  it("keeps the text of a node it does not understand", () => {
    // Losing formatting on export is acceptable; losing content is not.
    const md = documentToMarkdown(doc({ type: "someFutureBlock", content: [p(t("kept"))] }));
    expect(md).toBe("kept\n");
  });

  it("ends with exactly one newline and no blank-line runs", () => {
    const md = documentToMarkdown(doc(p(t("a")), { type: "paragraph" }, p(t("b"))), "T");
    expect(md).toBe("# T\n\na\n\nb\n");
  });
});
