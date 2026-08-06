import type { JSONContent } from "@tiptap/core";
import { extractText } from "./render.js";

/**
 * Revision diff at the projection level (ADR 0006): compare two revisions'
 * ProseMirror JSON trees block by block — never CRDT internals.
 */

export type DiffBlock =
  | { kind: "same"; node: JSONContent }
  | { kind: "added"; node: JSONContent }
  | { kind: "removed"; node: JSONContent }
  | { kind: "modified"; from: JSONContent; to: JSONContent };

const signature = (node: JSONContent) => JSON.stringify(node);

function blockText(node: JSONContent): string {
  return extractText({ type: "doc", content: [node] });
}

/** Longest-common-subsequence over block signatures. */
function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

export function diffDocuments(from: JSONContent, to: JSONContent): DiffBlock[] {
  const a = from.content ?? [];
  const b = to.content ?? [];
  const table = lcsTable(a.map(signature), b.map(signature));

  const raw: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (signature(a[i]!) === signature(b[j]!)) {
      raw.push({ kind: "same", node: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      raw.push({ kind: "removed", node: a[i]! });
      i++;
    } else {
      raw.push({ kind: "added", node: b[j]! });
      j++;
    }
  }
  while (i < a.length) raw.push({ kind: "removed", node: a[i++]! });
  while (j < b.length) raw.push({ kind: "added", node: b[j++]! });

  // Pair adjacent removed+added blocks of the same type as an in-place edit.
  const result: DiffBlock[] = [];
  for (let k = 0; k < raw.length; k++) {
    const current = raw[k]!;
    const next = raw[k + 1];
    if (
      current.kind === "removed" &&
      next?.kind === "added" &&
      current.node.type === next.node.type
    ) {
      result.push({ kind: "modified", from: current.node, to: next.node });
      k++;
    } else {
      result.push(current);
    }
  }
  return result;
}

export type WordDiffPart = { type: "same" | "added" | "removed"; text: string };

/** Word-level diff for modified text blocks (the inline red/green spans of frame 4). */
export function diffWords(fromNode: JSONContent, toNode: JSONContent): WordDiffPart[] {
  const a = blockText(fromNode).split(/\s+/).filter(Boolean);
  const b = blockText(toNode).split(/\s+/).filter(Boolean);
  const table = lcsTable(a, b);

  const parts: WordDiffPart[] = [];
  const push = (type: WordDiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += ` ${text}`;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push("removed", a[i]!);
      i++;
    } else {
      push("added", b[j]!);
      j++;
    }
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return parts;
}
