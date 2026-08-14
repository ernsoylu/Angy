import { describe, expect, it } from "vitest";
import { documentToMarkdown } from "./markdown.js";
import { markdownToDocument } from "./markdown-import.js";

const parse = (md: string) => markdownToDocument(md).doc.content ?? [];

describe("markdownToDocument", () => {
  it("lifts a leading H1 out as the page title", () => {
    // That is where documentToMarkdown puts it; leaving it in the body would
    // give every imported page its name twice.
    const result = markdownToDocument("# Architecture\n\nBody.\n");
    expect(result.title).toBe("Architecture");
    expect(result.doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Body." }] },
    ]);
  });

  it("keeps a later H1 in the body", () => {
    const result = markdownToDocument("Intro\n\n# Not the title\n");
    expect(result.title).toBeNull();
    expect(result.doc.content?.[1]?.type).toBe("heading");
  });

  it("clamps headings to the three levels the schema has", () => {
    // StarterKit is configured for h1–h3; an h5 that stayed an h5 would be
    // rejected by the schema when the Y.Doc is built.
    expect(parse("##### Deep\n")[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Deep" }],
    });
  });

  it("reads inline marks, including nested ones", () => {
    const [para] = parse("**bold** and *italic* and `code` and ~~gone~~\n");
    const marks = (para!.content ?? []).map((n) => n.marks?.map((m) => m.type) ?? []);
    expect(marks).toContainEqual(["bold"]);
    expect(marks).toContainEqual(["italic"]);
    expect(marks).toContainEqual(["code"]);
    expect(marks).toContainEqual(["strike"]);
  });

  it("reads links with their href", () => {
    const [para] = parse("[docs](https://example.com)\n");
    expect(para!.content?.[0]?.marks?.[0]).toEqual({
      type: "link",
      attrs: { href: "https://example.com" },
    });
  });

  it("treats a single newline as a space, not a break", () => {
    const [para] = parse("one\ntwo\n");
    expect((para!.content ?? []).map((n) => n.text).join("")).toBe("one two");
  });

  it("reads fenced code with its language", () => {
    expect(parse("```ts\nconst a = 1;\n```\n")[0]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const a = 1;" }],
    });
  });

  it("reads lists, and an ordered list's start", () => {
    expect(parse("- a\n- b\n")[0]?.type).toBe("bulletList");
    const ordered = parse("3. three\n4. four\n")[0];
    expect(ordered?.type).toBe("orderedList");
    expect(ordered?.attrs).toEqual({ start: 3 });
  });

  it("reads GitHub checkboxes as a task list", () => {
    // markdown-it leaves these as literal "[ ] " text; the schema needs real
    // taskItem nodes or the tasks board never sees them.
    const list = parse("- [ ] open\n- [x] done\n")[0];
    expect(list?.type).toBe("taskList");
    expect(list?.content?.map((item) => item.attrs?.checked)).toEqual([false, true]);
    expect(list?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe("open");
  });

  it("does not turn a partly-checkbox list into a task list", () => {
    const list = parse("- [ ] open\n- ordinary\n")[0];
    expect(list?.type).toBe("bulletList");
  });

  it("nests a sub-list inside its parent item", () => {
    const list = parse("- parent\n  - child\n")[0];
    expect(list?.content?.[0]?.content?.[1]?.type).toBe("bulletList");
  });

  it("reads blockquotes and rules", () => {
    expect(parse("> quoted\n")[0]?.type).toBe("blockquote");
    expect(parse("---\n")[0]?.type).toBe("horizontalRule");
  });

  it("reads a table, marking the header row", () => {
    const table = parse("| a | b |\n| --- | --- |\n| 1 | 2 |\n")[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
  });

  it("unwraps a lone image rather than leaving it in a paragraph", () => {
    expect(parse("![alt](/x.png)\n")[0]).toEqual({
      type: "image",
      attrs: { src: "/x.png", alt: "alt" },
    });
  });

  it("gives an empty file a blank paragraph, not an empty doc", () => {
    // ProseMirror rejects a doc with no content.
    expect(markdownToDocument("").doc.content).toEqual([{ type: "paragraph" }]);
  });
});

describe("export → import", () => {
  /**
   * Not a round-trip guarantee — ADR 0005 is explicit that documents do not
   * round-trip, and CRDT history certainly does not. This only pins that the
   * two halves agree on the syntax they each speak, so a page exported from
   * Angy and imported back is recognisably the same page.
   */
  const sample = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
      { type: "paragraph", content: [{ type: "text", text: "plain" }] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }],
          },
        ],
      },
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "x" }] },
    ],
  };

  it("survives a lap through Markdown", () => {
    const round = markdownToDocument(documentToMarkdown(sample, "Title"));
    expect(round.title).toBe("Title");
    expect(round.doc.content).toEqual(sample.content);
  });

  it("keeps escaped punctuation as the literal text it was", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a*b_c[d]" }] }],
    };
    expect(markdownToDocument(documentToMarkdown(doc)).doc.content).toEqual(doc.content);
  });
});
