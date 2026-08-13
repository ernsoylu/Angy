import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { baseExtensions } from "./extensions.js";
import { EMPTY_DOCUMENT } from "./render.js";

/**
 * y-prosemirror stores the ProseMirror fragment under this Y.Doc key. It must
 * match the Tiptap Collaboration extension's default field — one Y.Doc = one
 * page, always (hard rule 4).
 */
export const YDOC_FIELD = "default";

/**
 * The page title is a collaborative Y.Text living in the *same* Y.Doc as the
 * body — one Y.Doc = one page (hard rule 4), so the title travels with the
 * content through sync, persistence, revisions, and restore.
 */
export const TITLE_FIELD = "title";

/** Read the collaborative title. Empty means the doc predates the field. */
export function ydocTitle(ydoc: Y.Doc): string {
  return ydoc.getText(TITLE_FIELD).toString();
}

/**
 * Rewrite a Y.Text to `next` by editing only what changed. A wholesale
 * delete-and-reinsert would clobber a concurrent editor's keystrokes and jump
 * everyone's caret to the end; matching the common prefix and suffix keeps
 * simultaneous edits to other parts of the string intact.
 */
export function applyTextDiff(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;

  const max = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < max && current[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteCount = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  const edit = () => {
    if (deleteCount > 0) text.delete(prefix, deleteCount);
    if (inserted) text.insert(prefix, inserted);
  };
  // One transaction so remote peers see the replacement, not an empty flicker.
  if (text.doc) text.doc.transact(edit);
  else edit();
}

/** Visit every XmlElement in a live document's body, depth first. */
function walkElements(node: Y.XmlFragment | Y.XmlElement, visit: (el: Y.XmlElement) => void): void {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      visit(child);
      walkElements(child, visit);
    }
  }
}

/** What a document references: page ids for links, user ids for mentions. */
export interface ReferenceTargets {
  pageIds: string[];
  userIds: string[];
}

/**
 * The things this document references, read straight off the CRDT.
 *
 * Deliberately not `ydocToJson(...)` then `extractRefs(...)`: this runs on
 * every document load, and materialising the whole ProseMirror tree to answer
 * "are there any references here" costs the entire document to learn, usually,
 * that there are none.
 */
export function referenceTargets(ydoc: Y.Doc): ReferenceTargets {
  const pageIds = new Set<string>();
  const userIds = new Set<string>();
  walkElements(ydoc.getXmlFragment(YDOC_FIELD), (el) => {
    if (el.nodeName === "pageLink") {
      const pageId = el.getAttribute("pageId");
      if (typeof pageId === "string" && pageId) pageIds.add(pageId);
    } else if (el.nodeName === "mention") {
      const userId = el.getAttribute("userId");
      if (typeof userId === "string" && userId) userIds.add(userId);
    }
  });
  return { pageIds: [...pageIds], userIds: [...userIds] };
}

/** Which attribute each reference kind keeps its cached label in. */
const LABEL_ATTR = { pageLink: "title", mention: "label" } as const;

/**
 * Point cached labels in a live document at their targets' current names.
 *
 * The authored label is a cache that goes stale when the target is renamed.
 * The *reader* never sees that, because the projection resolves labels on the
 * way to rendered_html — but the editor renders straight from the Y.Doc, so
 * the stale name survives there until the node itself is rewritten. This is
 * that rewrite, applied as an ordinary forward edit so open collaborators
 * converge on it like any other change.
 *
 * Returns the number of labels changed. Zero means no attribute was touched
 * and therefore no Yjs update was produced — which is what keeps a document
 * that is already correct from being re-stored, re-projected and checkpointed
 * on every load.
 */
export function relabelReferences(
  ydoc: Y.Doc,
  names: { pages: ReadonlyMap<string, string>; users: ReadonlyMap<string, string> },
): number {
  let changed = 0;
  const apply = () => {
    walkElements(ydoc.getXmlFragment(YDOC_FIELD), (el) => {
      const kind = el.nodeName === "pageLink" || el.nodeName === "mention" ? el.nodeName : null;
      if (kind === null) return;
      const idAttr = kind === "pageLink" ? "pageId" : "userId";
      const id = el.getAttribute(idAttr);
      if (typeof id !== "string") return;
      const name = (kind === "pageLink" ? names.pages : names.users).get(id);
      // A target that is gone keeps the name it was referenced under: a link
      // reading "Untitled" is worse than one naming what it pointed at.
      if (name === undefined || name === el.getAttribute(LABEL_ATTR[kind])) return;
      el.setAttribute(LABEL_ATTR[kind], name);
      changed++;
    });
  };
  // One transaction, so peers see a single relabel rather than a node at a time.
  ydoc.transact(apply);
  return changed;
}

/** Build a fresh Y.Doc from ProseMirror JSON — the ONLY place docs are born from JSON. */
export function createYdocFromJson(doc: JSONContent | null | undefined): Y.Doc {
  return prosemirrorJSONToYDoc(getSchema(baseExtensions()), doc ?? EMPTY_DOCUMENT, YDOC_FIELD);
}

/** Project a Y.Doc back to ProseMirror JSON (for rendered_html / text_extract). */
export function ydocToJson(ydoc: Y.Doc): JSONContent {
  return yDocToProsemirrorJSON(ydoc, YDOC_FIELD) as JSONContent;
}

/**
 * Materialize persisted update bytes as ProseMirror JSON. The Y.Doc lives and
 * dies inside this module — CJS consumers (the API) must never construct
 * Y.Docs themselves: mixing the CJS and ESM yjs builds creates two instances
 * and breaks y-prosemirror (CLAUDE.md gotcha: enforce a single yjs copy).
 */
export function updateToJson(update: Uint8Array): JSONContent {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, update);
  const json = ydocToJson(ydoc);
  ydoc.destroy();
  return json;
}
