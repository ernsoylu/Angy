import type { JSONContent } from "@tiptap/core";

/**
 * The `block_index` extractor: what a document *references*, pulled out of the
 * ProseMirror JSON so it can be queried in SQL (V2 H1).
 *
 * Granularity is **one row per actionable node**, not one per block — the shape
 * ADR 0001 committed to ("actionable blocks only"). Indexing every paragraph
 * would multiply the row count by an order of magnitude to serve no query any
 * consumer has; collapsing to one row per (page, target) would be smaller still
 * but leaves nowhere to put a task's text or done-state, so a tasks board could
 * not be built on it. Occurrence-level splits the difference: rows scale with
 * links and mentions, not with document size.
 *
 * This stays a pure JSON→rows function. `block_index` is a projection —
 * derived, disposable, rebuildable from the Y.Doc, and never written by the
 * editor (hard rule 2 forbids a block *relational* table; this is not one).
 */

/** V1 ships `pageLink` alone; `mention`, `task` and macros land on these rows. */
export type RefKind = "page_link";

export interface DocRef {
  /** Document order of the actionable node. Part of the row's identity. */
  ord: number;
  kind: RefKind;
  /** Set for `page_link`; the uuid of the page being linked to. */
  targetPageId: string | null;
  /** Set for `mention` (V2); the mentioned user's dense bigint id, as a string. */
  targetUserId: string | null;
  /**
   * Per-occurrence body — a task's text and done-state, a macro's parameters.
   *
   * For a page link this carries `{ label }`: the title *as rendered into
   * `rendered_html`*, not the one authored into the Y.Doc. That distinction is
   * what makes the stale-title refresh converge — see `resolvePageLinkTitles`.
   */
  payload: Record<string, unknown> | null;
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Walk every node in document order, parents before children. */
function walk(node: JSONContent, visit: (node: JSONContent) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

/**
 * Every actionable node in the document, in document order.
 *
 * Call this on the *resolved* document — the one `resolvePageLinkTitles`
 * returned and `rendered_html` was generated from. Extracting from the raw
 * Y.Doc JSON instead would record labels the reader never saw, and the
 * stale-title refresh compares against exactly that recorded label.
 *
 * A link with no resolvable target page is skipped rather than indexed with a
 * null target: a row that points nowhere answers no query and would have to be
 * filtered out of every consumer.
 */
export function extractRefs(doc: JSONContent): DocRef[] {
  const refs: DocRef[] = [];
  walk(doc, (node) => {
    if (node.type !== "pageLink") return;
    const pageId = node.attrs?.pageId;
    if (!isUuid(pageId)) return;
    refs.push({
      ord: refs.length,
      kind: "page_link",
      targetPageId: pageId,
      targetUserId: null,
      payload: { label: linkLabel(node) },
    });
  });
  return refs;
}

const linkLabel = (node: JSONContent): string =>
  (typeof node.attrs?.title === "string" && node.attrs.title.trim()) || "Untitled";

/**
 * Replace each page link's cached `title` with the target's current one.
 *
 * V1 accepted stale link labels because fixing them needs a backlink index to
 * know which documents to refresh — that index is this one. The substitution
 * happens here, on the projection, and deliberately not in the Y.Doc: the
 * authored attribute stays exactly as the editor wrote it, so nothing gives
 * `page.title` a second writer alongside `onStoreDocument`, and the static
 * renderer stays a pure JSON→HTML function that never queries a database.
 *
 * A target missing from `titles` (trashed, or gone) keeps its authored label —
 * a link that suddenly reads "Untitled" is worse than one reading the name the
 * page had when it was linked.
 *
 * Returns the same object when nothing changed, so callers can tell cheaply.
 */
export function resolvePageLinkTitles(
  doc: JSONContent,
  titles: ReadonlyMap<string, string>,
): JSONContent {
  let changed = false;

  const rewrite = (node: JSONContent): JSONContent => {
    let next = node;
    if (node.type === "pageLink") {
      const pageId = node.attrs?.pageId;
      const fresh = isUuid(pageId) ? titles.get(pageId) : undefined;
      if (fresh !== undefined && fresh !== node.attrs?.title) {
        next = { ...node, attrs: { ...node.attrs, title: fresh } };
        changed = true;
      }
    }
    if (!node.content) return next;
    const content = node.content.map(rewrite);
    if (content.some((child, i) => child !== node.content![i])) {
      next = { ...next, content };
    }
    return next;
  };

  const result = rewrite(doc);
  return changed ? result : doc;
}
