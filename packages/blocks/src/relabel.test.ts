import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import { extractRefs } from "./refs.js";
import { createYdocFromJson, pageLinkTargets, relabelPageLinks, ydocToJson } from "./ydoc.js";

/**
 * Relabelling links inside a live Y.Doc — the editor-side half of the
 * stale-label fix. The projection half lives in refs.test.ts; this one is
 * about the CRDT, so it asserts on update bytes as well as content.
 */

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

const link = (pageId: string, title: string): JSONContent => ({
  type: "pageLink",
  attrs: { pageId, title },
});

const docWith = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "See:" }] }, ...content],
});

const labels = (ydoc: Y.Doc) =>
  extractRefs(ydocToJson(ydoc)).map((ref) => ref.payload?.label);

describe("pageLinkTargets", () => {
  it("finds every distinct target without materialising the document", () => {
    const ydoc = createYdocFromJson(docWith(link(ALPHA, "A"), link(BETA, "B"), link(ALPHA, "A")));
    expect(pageLinkTargets(ydoc).sort()).toEqual([ALPHA, BETA].sort());
    ydoc.destroy();
  });

  it("finds links nested inside container blocks", () => {
    const ydoc = createYdocFromJson(
      docWith({ type: "callout", attrs: { tone: "info" }, content: [link(BETA, "Runbook")] }),
    );
    expect(pageLinkTargets(ydoc)).toEqual([BETA]);
    ydoc.destroy();
  });

  it("is empty for a document with no links", () => {
    const ydoc = createYdocFromJson(docWith());
    expect(pageLinkTargets(ydoc)).toEqual([]);
    ydoc.destroy();
  });
});

describe("relabelPageLinks", () => {
  it("rewrites the label to the target's current title", () => {
    const ydoc = createYdocFromJson(docWith(link(ALPHA, "Old name")));
    expect(relabelPageLinks(ydoc, new Map([[ALPHA, "New name"]]))).toBe(1);
    expect(labels(ydoc)).toEqual(["New name"]);
    ydoc.destroy();
  });

  it("rewrites every occurrence, including nested ones", () => {
    const ydoc = createYdocFromJson(
      docWith(link(ALPHA, "Old"), {
        type: "callout",
        attrs: { tone: "info" },
        content: [link(ALPHA, "Old")],
      }),
    );
    expect(relabelPageLinks(ydoc, new Map([[ALPHA, "Fresh"]]))).toBe(2);
    expect(labels(ydoc)).toEqual(["Fresh", "Fresh"]);
    ydoc.destroy();
  });

  it("leaves links to other pages alone", () => {
    const ydoc = createYdocFromJson(docWith(link(ALPHA, "Alpha"), link(BETA, "Beta")));
    relabelPageLinks(ydoc, new Map([[ALPHA, "Alpha Renamed"]]));
    expect(labels(ydoc)).toEqual(["Alpha Renamed", "Beta"]);
    ydoc.destroy();
  });

  it("keeps the authored label when the target is missing", () => {
    // A trashed or deleted target: a link reading its last known name beats one
    // reading "Untitled".
    const ydoc = createYdocFromJson(docWith(link(ALPHA, "Deleted page")));
    expect(relabelPageLinks(ydoc, new Map())).toBe(0);
    expect(labels(ydoc)).toEqual(["Deleted page"]);
    ydoc.destroy();
  });

  it("produces NO update when every label is already correct", () => {
    // The load path calls this on every document open. If an unchanged document
    // still emitted an update it would be re-stored, re-projected and
    // checkpointed for having been looked at.
    const ydoc = createYdocFromJson(docWith(link(ALPHA, "Architecture")));
    const before = Y.encodeStateVector(ydoc);

    let updates = 0;
    ydoc.on("update", () => updates++);
    expect(relabelPageLinks(ydoc, new Map([[ALPHA, "Architecture"]]))).toBe(0);

    expect(updates).toBe(0);
    expect(Y.encodeStateVector(ydoc)).toEqual(before);
    ydoc.destroy();
  });

  it("emits one update for the whole relabel, not one per node", () => {
    const ydoc = createYdocFromJson(docWith(link(ALPHA, "Old"), link(ALPHA, "Old")));
    let updates = 0;
    ydoc.on("update", () => updates++);
    relabelPageLinks(ydoc, new Map([[ALPHA, "New"]]));
    // Peers see a single relabel rather than the document changing twice.
    expect(updates).toBe(1);
    ydoc.destroy();
  });

  it("converges rather than forking — the edit is an ordinary update", () => {
    const server = createYdocFromJson(docWith(link(ALPHA, "Old")));
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));

    const relabelUpdate = (() => {
      let captured: Uint8Array | null = null;
      server.once("update", (u: Uint8Array) => (captured = u));
      relabelPageLinks(server, new Map([[ALPHA, "New"]]));
      return captured!;
    })();

    Y.applyUpdate(client, relabelUpdate);
    expect(labels(client)).toEqual(["New"]);
    expect(ydocToJson(client)).toEqual(ydocToJson(server));
    server.destroy();
    client.destroy();
  });
});
