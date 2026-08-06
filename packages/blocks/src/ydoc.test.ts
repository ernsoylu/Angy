import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import { applyDocJson } from "./restore.js";
import { createYdocFromJson, updateToJson, ydocToJson } from "./ydoc.js";

const doc = (...texts: string[]): JSONContent => ({
  type: "doc",
  content: texts.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

describe("ydoc round-trip", () => {
  it("converts ProseMirror JSON to a Y.Doc and back losslessly", () => {
    const original = doc("first paragraph", "second paragraph");
    const ydoc = createYdocFromJson(original);
    expect(ydocToJson(ydoc)).toEqual(original);
    ydoc.destroy();
  });

  it("materializes encoded update bytes without the caller touching yjs", () => {
    const original = doc("bytes in, JSON out");
    const ydoc = createYdocFromJson(original);
    const bytes = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    expect(updateToJson(bytes)).toEqual(original);
  });

  it("handles null/empty documents with the empty-doc fallback", () => {
    const ydoc = createYdocFromJson(null);
    expect(ydocToJson(ydoc).content?.[0]?.type).toBe("paragraph");
    ydoc.destroy();
  });
});

describe("applyDocJson (non-destructive restore)", () => {
  it("applies old content to a live doc as a forward update", () => {
    const v1 = doc("original line");
    const ydoc = createYdocFromJson(v1);
    const beforeVector = Y.encodeStateVector(ydoc);

    applyDocJson(ydoc, doc("original line", "added later"));
    expect(ydocToJson(ydoc)).toEqual(doc("original line", "added later"));

    // "Restore" v1: content reverts, but history moved FORWARD (state grew).
    applyDocJson(ydoc, v1);
    expect(ydocToJson(ydoc)).toEqual(v1);
    expect(Y.encodeStateVector(ydoc)).not.toEqual(beforeVector);
    ydoc.destroy();
  });

  it("propagates the restore to a synced peer like any other edit", () => {
    const ydocA = createYdocFromJson(doc("shared"));
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
    ydocA.on("update", (update: Uint8Array) => Y.applyUpdate(ydocB, update));

    applyDocJson(ydocA, doc("shared", "restored state"));
    expect(ydocToJson(ydocB)).toEqual(doc("shared", "restored state"));
    ydocA.destroy();
    ydocB.destroy();
  });
});
