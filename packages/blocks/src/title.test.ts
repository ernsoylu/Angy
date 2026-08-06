import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyTextDiff, TITLE_FIELD, ydocTitle } from "./ydoc.js";

function titled(text: string): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.getText(TITLE_FIELD).insert(0, text);
  return ydoc;
}

/** Two docs kept in sync, the way two browsers on one page are. */
function pair(text: string): [Y.Doc, Y.Doc] {
  const a = titled(text);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.on("update", (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on("update", (u: Uint8Array) => Y.applyUpdate(a, u));
  return [a, b];
}

describe("collaborative title", () => {
  it("reads an empty string for a doc that predates the field", () => {
    const ydoc = new Y.Doc();
    expect(ydocTitle(ydoc)).toBe("");
    ydoc.destroy();
  });

  it("is a no-op when the text already matches", () => {
    const ydoc = titled("Runbooks");
    const before = Y.encodeStateVector(ydoc);
    applyTextDiff(ydoc.getText(TITLE_FIELD), "Runbooks");
    expect(Y.encodeStateVector(ydoc)).toEqual(before);
    ydoc.destroy();
  });

  it("applies appends, prepends, deletions and replacements", () => {
    for (const [from, to] of [
      ["Runbooks", "Runbooks v2"],
      ["Runbooks", "Ops Runbooks"],
      ["Runbooks", "Runs"],
      ["Runbooks", "Playbooks"],
      ["Runbooks", ""],
      ["", "Fresh"],
      ["Runbooks", "Runbooks"],
    ]) {
      const ydoc = titled(from!);
      applyTextDiff(ydoc.getText(TITLE_FIELD), to!);
      expect(ydocTitle(ydoc)).toBe(to);
      ydoc.destroy();
    }
  });

  it("edits only the changed span, leaving a concurrent edit elsewhere intact", () => {
    // Two editors fork from the same title and edit different ends offline.
    const origin = titled("Realtime Sync Architecture");
    const a = new Y.Doc();
    const b = new Y.Doc();
    for (const d of [a, b]) Y.applyUpdate(d, Y.encodeStateAsUpdate(origin));

    applyTextDiff(a.getText(TITLE_FIELD), "Realtime Sync Architecture (v2)"); // appends
    applyTextDiff(b.getText(TITLE_FIELD), "Live Sync Architecture"); // rewrites word 1

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // They converge and both edits survive; a wholesale delete-and-reinsert
    // would have dropped one of them outright.
    expect(ydocTitle(a)).toBe(ydocTitle(b));
    expect(ydocTitle(a)).toContain("(v2)");
    expect(ydocTitle(a)).toContain("Live");

    for (const d of [origin, a, b]) d.destroy();
  });

  it("propagates a rename to a synced peer", () => {
    const [a, b] = pair("Decisions");
    applyTextDiff(a.getText(TITLE_FIELD), "Decisions (ADR)");
    expect(ydocTitle(b)).toBe("Decisions (ADR)");
    a.destroy();
    b.destroy();
  });
});
