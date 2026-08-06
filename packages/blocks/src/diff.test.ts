import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { diffDocuments, diffWords } from "./diff.js";

const p = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

describe("diffDocuments", () => {
  it("reports identical documents as all-same", () => {
    const d = doc(p("one"), p("two"));
    expect(diffDocuments(d, d).map((b) => b.kind)).toEqual(["same", "same"]);
  });

  it("detects added blocks", () => {
    const kinds = diffDocuments(doc(p("one")), doc(p("one"), p("two"))).map((b) => b.kind);
    expect(kinds).toEqual(["same", "added"]);
  });

  it("detects removed blocks", () => {
    const kinds = diffDocuments(doc(p("one"), p("two")), doc(p("two"))).map((b) => b.kind);
    expect(kinds).toEqual(["removed", "same"]);
  });

  it("pairs an in-place text edit as modified", () => {
    const result = diffDocuments(
      doc(p("history uses snapshots"), p("stable")),
      doc(p("history uses full-state blobs"), p("stable")),
    );
    expect(result[0]!.kind).toBe("modified");
    expect(result[1]!.kind).toBe("same");
  });

  it("does not pair blocks of different types", () => {
    const kinds = diffDocuments(
      doc(p("text")),
      doc({ type: "codeBlock", content: [{ type: "text", text: "code" }] }),
    ).map((b) => b.kind);
    expect(kinds).toEqual(["removed", "added"]);
  });
});

describe("diffWords", () => {
  it("marks changed words and keeps stable ones", () => {
    const parts = diffWords(
      p("History is captured as Yjs Snapshot objects"),
      p("History is captured as full-state blobs"),
    );
    expect(parts).toEqual([
      { type: "same", text: "History is captured as" },
      { type: "removed", text: "Yjs Snapshot objects" },
      { type: "added", text: "full-state blobs" },
    ]);
  });
});
