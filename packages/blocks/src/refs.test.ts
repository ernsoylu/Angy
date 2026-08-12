import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { extractRefs, resolvePageLinkTitles } from "./refs.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

const link = (pageId: string, title: string): JSONContent => ({
  type: "pageLink",
  attrs: { pageId, title },
});

const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

const prose: JSONContent = {
  type: "paragraph",
  content: [{ type: "text", text: "Readers are served pre-rendered HTML." }],
};

describe("extractRefs", () => {
  it("indexes actionable nodes only, never the prose around them", () => {
    const refs = extractRefs(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "架构" }] },
        prose,
        link(ALPHA, "Architecture"),
        { type: "divider" },
      ),
    );

    expect(refs).toEqual([
      {
        ord: 0,
        kind: "page_link",
        targetPageId: ALPHA,
        targetUserId: null,
        payload: { label: "Architecture" },
      },
    ]);
  });

  it("keeps every occurrence, because a task board needs per-occurrence state", () => {
    // The rejected (page, entity) shape would collapse these two into one row.
    const refs = extractRefs(doc(link(ALPHA, "Architecture"), prose, link(ALPHA, "See also")));

    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.ord)).toEqual([0, 1]);
    expect(refs.map((r) => r.payload?.label)).toEqual(["Architecture", "See also"]);
  });

  it("finds links nested inside container blocks", () => {
    const refs = extractRefs(
      doc({
        type: "callout",
        attrs: { tone: "info" },
        content: [link(BETA, "Runbook")],
      }),
    );

    expect(refs.map((r) => r.targetPageId)).toEqual([BETA]);
  });

  it("skips links with no resolvable target rather than indexing a null row", () => {
    const refs = extractRefs(
      doc(
        { type: "pageLink", attrs: { pageId: null, title: "Dangling" } },
        { type: "pageLink", attrs: { pageId: "not-a-uuid", title: "Malformed" } },
        link(ALPHA, "Real"),
      ),
    );

    expect(refs.map((r) => r.payload?.label)).toEqual(["Real"]);
  });

  it("falls back to Untitled so the recorded label is never empty", () => {
    const refs = extractRefs(doc({ type: "pageLink", attrs: { pageId: BETA, title: "   " } }));

    expect(refs[0]?.payload).toEqual({ label: "Untitled" });
  });
});

describe("resolvePageLinkTitles", () => {
  it("substitutes the target's current title", () => {
    const source = doc(prose, link(ALPHA, "Old name"));
    const resolved = resolvePageLinkTitles(source, new Map([[ALPHA, "New name"]]));

    expect(resolved.content?.[1]?.attrs?.title).toBe("New name");
    // The rendered label is what gets indexed, so the refresh check converges.
    expect(extractRefs(resolved)[0]?.payload).toEqual({ label: "New name" });
  });

  it("leaves the authored document untouched", () => {
    const source = doc(link(ALPHA, "Old name"));
    resolvePageLinkTitles(source, new Map([[ALPHA, "New name"]]));

    // The Y.Doc keeps what the editor wrote; only the projection is refreshed.
    expect(source.content?.[0]?.attrs?.title).toBe("Old name");
  });

  it("rewrites links nested inside containers", () => {
    const source = doc({
      type: "callout",
      attrs: { tone: "info" },
      content: [link(BETA, "Old runbook")],
    });
    const resolved = resolvePageLinkTitles(source, new Map([[BETA, "Compaction runbook"]]));

    expect(resolved.content?.[0]?.content?.[0]?.attrs?.title).toBe("Compaction runbook");
  });

  it("keeps the authored label when the target is trashed or gone", () => {
    const source = doc(link(ALPHA, "Deleted page"));
    const resolved = resolvePageLinkTitles(source, new Map());

    expect(resolved.content?.[0]?.attrs?.title).toBe("Deleted page");
  });

  it("returns the same object when nothing drifted", () => {
    const source = doc(prose, link(ALPHA, "Architecture"));

    expect(resolvePageLinkTitles(source, new Map([[ALPHA, "Architecture"]]))).toBe(source);
    expect(resolvePageLinkTitles(source, new Map())).toBe(source);
  });
});
