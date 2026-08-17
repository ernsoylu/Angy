import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { extractCommentThreadIds } from "./comment.js";
import { renderDocumentToHtml } from "./render.js";
import { createYdocFromJson, ydocToJson } from "./ydoc.js";

const marked = (text: string, threadId: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "comment", attrs: { threadId } }],
});

const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const para = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });

describe("extractCommentThreadIds", () => {
  it("finds anchors anywhere in the document, in order", () => {
    const document = doc(
      para({ type: "text", text: "plain " }, marked("first", "t-1")),
      para(marked("second", "t-2")),
    );
    expect(extractCommentThreadIds(document)).toEqual(["t-1", "t-2"]);
  });

  it("reports one id per thread however many ranges carry it", () => {
    // Copying commented text duplicates the mark, which is the honest reading
    // of what copying it means — but it is still one conversation.
    const document = doc(para(marked("here", "t-1")), para(marked("and here", "t-1")));
    expect(extractCommentThreadIds(document)).toEqual(["t-1"]);
  });

  it("ignores every other mark", () => {
    const document = doc(
      para({ type: "text", text: "bold", marks: [{ type: "bold" }] }),
      para({ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "/x" } }] }),
    );
    expect(extractCommentThreadIds(document)).toEqual([]);
  });

  it("returns nothing for a document with no comments", () => {
    expect(extractCommentThreadIds(doc(para({ type: "text", text: "quiet" })))).toEqual([]);
  });
});

describe("the comment mark in the shared schema", () => {
  it("renders an anchor the reader can style, carrying only the thread id", () => {
    const html = renderDocumentToHtml(doc(para(marked("review this", "9f1"))));
    expect(html).toContain('data-thread-id="9f1"');
    expect(html).toContain("review this");
    expect(html).toMatch(/<mark[^>]*>/);
  });

  it("survives the round trip through a Y.Doc", () => {
    // The isomorphic-block invariant: if the mark were only known to the
    // editor, every anchor would be dropped the moment the worker rebuilt the
    // projection from the CRDT.
    const original = doc(para({ type: "text", text: "keep " }, marked("this", "abc")));
    const back = ydocToJson(createYdocFromJson(original));
    expect(extractCommentThreadIds(back)).toEqual(["abc"]);
  });

  it("lets two threads overlap the same words", () => {
    // Marks of one type exclude themselves by default; comments must not,
    // because two people reviewing the same sentence is ordinary.
    const overlapping: JSONContent = {
      type: "text",
      text: "contested",
      marks: [
        { type: "comment", attrs: { threadId: "t-1" } },
        { type: "comment", attrs: { threadId: "t-2" } },
      ],
    };
    const back = ydocToJson(createYdocFromJson(doc(para(overlapping))));
    expect(extractCommentThreadIds(back).sort()).toEqual(["t-1", "t-2"]);
  });
});
