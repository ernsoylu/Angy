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

/** Macro kinds land on these same rows as they are built. */
export type RefKind = "page_link" | "mention" | "task";

export interface DocRef {
  /** Document order of the actionable node. Part of the row's identity. */
  ord: number;
  kind: RefKind;
  /** Set for `page_link`; the uuid of the page being linked to. */
  targetPageId: string | null;
  /** Set for `mention`; the mentioned user's dense bigint id, as a string. */
  targetUserId: string | null;
  /**
   * Per-occurrence body — a task's text and done-state, a macro's parameters.
   *
   * For a page link or a mention this carries `{ label }`: the text *as
   * rendered into `rendered_html`*, not the one authored into the Y.Doc. That
   * distinction is what makes the stale-label refresh converge — see
   * `resolveRefLabels`.
   */
  payload: Record<string, unknown> | null;
}

/**
 * Current names for the things a document references, keyed by id: page titles
 * for links, display names for mentions.
 */
export interface RefLabels {
  pages: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
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
    if (node.type === "pageLink") {
      const pageId = node.attrs?.pageId;
      if (!isUuid(pageId)) return;
      refs.push({
        ord: refs.length,
        kind: "page_link",
        targetPageId: pageId,
        targetUserId: null,
        payload: { label: nodeLabel(node) },
      });
      return;
    }
    if (node.type === "mention") {
      const userId = node.attrs?.userId;
      if (!isUserId(userId)) return;
      refs.push({
        ord: refs.length,
        kind: "mention",
        targetPageId: null,
        targetUserId: userId,
        payload: { label: nodeLabel(node) },
      });
      return;
    }
    if (node.type === "taskItem") {
      refs.push({
        ord: refs.length,
        kind: "task",
        targetPageId: null,
        // The first person named in the task is its assignee, which is what
        // makes "my tasks" an indexed lookup rather than a scan. Everyone else
        // named still gets their own mention row, so nobody is dropped.
        targetUserId: firstMentionedUser(node),
        payload: { label: taskText(node), done: node.attrs?.checked === true },
      });
    }
  });
  return refs;
}

/**
 * A task's own text, excluding any nested sub-tasks.
 *
 * Without that exclusion a parent would carry every descendant's text as its
 * own, and a board would show the same words on several rows.
 */
function taskText(node: JSONContent): string {
  const parts: string[] = [];
  const collect = (current: JSONContent): void => {
    if (current !== node && current.type === "taskList") return;
    if (current.type === "text" && current.text) parts.push(current.text);
    if (current !== node && current.type === "mention") {
      parts.push(`@${nodeLabel(current)}`);
      return;
    }
    for (const child of current.content ?? []) collect(child);
  };
  collect(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** The first mention inside a task, ignoring nested sub-tasks. */
function firstMentionedUser(node: JSONContent): string | null {
  let found: string | null = null;
  const search = (current: JSONContent): void => {
    if (found !== null) return;
    if (current !== node && current.type === "taskList") return;
    if (current.type === "mention" && isUserId(current.attrs?.userId)) {
      found = current.attrs.userId as string;
      return;
    }
    for (const child of current.content ?? []) search(child);
  };
  search(node);
  return found;
}

/** Dense bigint ids arrive as decimal strings; anything else is not an identity. */
const isUserId = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

/** A page link labels itself with `title`, a mention with `label`. */
const nodeLabel = (node: JSONContent): string => {
  const raw = node.type === "mention" ? node.attrs?.label : node.attrs?.title;
  const fallback = node.type === "mention" ? "someone" : "Untitled";
  return (typeof raw === "string" && raw.trim()) || fallback;
};

/**
 * Replace each reference's cached label with the target's current name — page
 * titles for links, display names for mentions.
 *
 * V1 accepted stale link labels because fixing them needs a backlink index to
 * know which documents to refresh — that index is this one. The substitution
 * happens here, on the projection, and deliberately not in the Y.Doc: the
 * authored attribute stays exactly as the editor wrote it, so nothing gives
 * `page.title` a second writer alongside `onStoreDocument`, and the static
 * renderer stays a pure JSON→HTML function that never queries a database.
 * (Editors, which render the Y.Doc, are repaired separately by
 * `relabelReferences`.)
 *
 * A target missing from the maps (trashed, deactivated, gone) keeps its
 * authored label — a reference that suddenly reads "Untitled" or "someone" is
 * worse than one naming what it pointed at.
 *
 * Returns the same object when nothing changed, so callers can tell cheaply.
 */
export function resolveRefLabels(doc: JSONContent, labels: RefLabels): JSONContent {
  let changed = false;

  const rewrite = (node: JSONContent): JSONContent => {
    let next = node;
    if (node.type === "pageLink") {
      const pageId = node.attrs?.pageId;
      const fresh = isUuid(pageId) ? labels.pages.get(pageId) : undefined;
      if (fresh !== undefined && fresh !== node.attrs?.title) {
        next = { ...node, attrs: { ...node.attrs, title: fresh } };
        changed = true;
      }
    } else if (node.type === "mention") {
      const userId = node.attrs?.userId;
      const fresh = isUserId(userId) ? labels.users.get(userId) : undefined;
      if (fresh !== undefined && fresh !== node.attrs?.label) {
        next = { ...node, attrs: { ...node.attrs, label: fresh } };
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
