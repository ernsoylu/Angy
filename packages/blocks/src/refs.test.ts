import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { extractRefs, resolveRefLabels } from "./refs.js";

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

  it("indexes mentions against the user, not a page", () => {
    const refs = extractRefs(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "ask " },
          { type: "mention", attrs: { userId: "7", label: "Ada Lovelace" } },
        ],
      }),
    );

    expect(refs).toEqual([
      {
        ord: 0,
        kind: "mention",
        targetPageId: null,
        targetUserId: "7",
        payload: { label: "Ada Lovelace" },
      },
    ]);
  });

  it("numbers links and mentions in one document order", () => {
    // `ord` is the row's identity, so the two kinds share a sequence rather
    // than each counting from zero and colliding on the primary key.
    const refs = extractRefs(
      doc(link(ALPHA, "Architecture"), {
        type: "paragraph",
        content: [{ type: "mention", attrs: { userId: "7", label: "Ada" } }],
      }),
    );

    expect(refs.map((r) => [r.ord, r.kind])).toEqual([
      [0, "page_link"],
      [1, "mention"],
    ]);
  });

  it("skips a mention with no usable user id", () => {
    const refs = extractRefs(
      doc({
        type: "paragraph",
        content: [
          { type: "mention", attrs: { userId: null, label: "Nobody" } },
          { type: "mention", attrs: { userId: "not-a-number", label: "Malformed" } },
          { type: "mention", attrs: { userId: "7", label: "Ada" } },
        ],
      }),
    );

    expect(refs.map((r) => r.payload?.label)).toEqual(["Ada"]);
  });
});

describe("resolveRefLabels", () => {
  it("substitutes the target's current title", () => {
    const source = doc(prose, link(ALPHA, "Old name"));
    const resolved = resolveRefLabels(source, { pages: new Map([[ALPHA, "New name"]]), users: new Map() });

    expect(resolved.content?.[1]?.attrs?.title).toBe("New name");
    // The rendered label is what gets indexed, so the refresh check converges.
    expect(extractRefs(resolved)[0]?.payload).toEqual({ label: "New name" });
  });

  it("leaves the authored document untouched", () => {
    const source = doc(link(ALPHA, "Old name"));
    resolveRefLabels(source, { pages: new Map([[ALPHA, "New name"]]), users: new Map() });

    // The Y.Doc keeps what the editor wrote; only the projection is refreshed.
    expect(source.content?.[0]?.attrs?.title).toBe("Old name");
  });

  it("rewrites links nested inside containers", () => {
    const source = doc({
      type: "callout",
      attrs: { tone: "info" },
      content: [link(BETA, "Old runbook")],
    });
    const resolved = resolveRefLabels(source, { pages: new Map([[BETA, "Compaction runbook"]]), users: new Map() });

    expect(resolved.content?.[0]?.content?.[0]?.attrs?.title).toBe("Compaction runbook");
  });

  it("keeps the authored label when the target is trashed or gone", () => {
    const source = doc(link(ALPHA, "Deleted page"));
    const resolved = resolveRefLabels(source, { pages: new Map(), users: new Map() });

    expect(resolved.content?.[0]?.attrs?.title).toBe("Deleted page");
  });

  it("substitutes a mention's display name from the users map", () => {
    const source = doc({
      type: "paragraph",
      content: [{ type: "mention", attrs: { userId: "7", label: "A. Lovelace" } }],
    });
    const resolved = resolveRefLabels(source, {
      pages: new Map(),
      users: new Map([["7", "Ada Lovelace"]]),
    });

    expect(extractRefs(resolved)[0]?.payload).toEqual({ label: "Ada Lovelace" });
    // The authored document is untouched, as with page links.
    expect(extractRefs(source)[0]?.payload).toEqual({ label: "A. Lovelace" });
  });

  it("keeps the authored name for a user it cannot resolve", () => {
    const source = doc({
      type: "paragraph",
      content: [{ type: "mention", attrs: { userId: "7", label: "Ada Lovelace" } }],
    });

    expect(resolveRefLabels(source, { pages: new Map(), users: new Map() })).toBe(source);
  });

  it("returns the same object when nothing drifted", () => {
    const source = doc(prose, link(ALPHA, "Architecture"));

    expect(resolveRefLabels(source, { pages: new Map([[ALPHA, "Architecture"]]), users: new Map() })).toBe(source);
    expect(resolveRefLabels(source, { pages: new Map(), users: new Map() })).toBe(source);
  });
});
