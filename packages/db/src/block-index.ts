import type { BlockRefKind, Prisma, PrismaClient } from "@prisma/client";

/**
 * `block_index` maintenance (V2 H1) — the projection of actionable nodes.
 *
 * The rows are derived, disposable and owned entirely by the projection job.
 * Every write here replaces a page's rows wholesale, which is what keeps the
 * table rebuildable from the Y.Doc at any time: there is no incremental state
 * to drift, and re-running a rebuild converges rather than accumulating.
 *
 * Structural, not nominal, on purpose: the input type mirrors `DocRef` in
 * @angy/blocks without importing it, so the database package does not take a
 * dependency on Tiptap to store a uuid and a label.
 */

export interface BlockRefInput {
  ord: number;
  kind: BlockRefKind;
  targetPageId: string | null;
  targetUserId: string | null;
  payload: Record<string, unknown> | null;
}

/** The rendered label recorded for a page-link row, if it has one. */
export function refLabel(payload: Prisma.JsonValue | null): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const label = (payload as Record<string, unknown>).label;
  return typeof label === "string" ? label : null;
}

/**
 * Replace every indexed reference for one page. Delete-then-insert rather than
 * a diff: a document's refs are re-derived in full on every projection rebuild,
 * so computing which rows changed would cost more than rewriting the handful
 * that exist.
 */
export async function replaceBlockIndex(
  prisma: PrismaClient,
  pageId: string,
  refs: readonly BlockRefInput[],
): Promise<void> {
  await prisma.$transaction([
    prisma.blockIndex.deleteMany({ where: { pageId } }),
    prisma.blockIndex.createMany({
      data: refs.map((ref) => ({
        pageId,
        ord: ref.ord,
        kind: ref.kind,
        targetPageId: ref.targetPageId,
        targetUserId: ref.targetUserId === null ? null : BigInt(ref.targetUserId),
        payload: (ref.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    }),
  ]);
}

/**
 * Live pages whose rendered link label for `pageId` no longer matches `title`.
 *
 * This is the stale-page-link fix (CLAUDE.md gotcha, deferred through V1). A
 * renamed page cannot rewrite the documents that link to it — their Y.Docs
 * carry the label they were authored with — so instead their *projections* are
 * rebuilt, and the rebuild resolves the label afresh.
 *
 * The label comparison is what makes that terminate. Refreshing every referrer
 * unconditionally would cascade: each rebuilt page would in turn refresh its
 * own referrers, and two pages linking to each other would never settle.
 * Comparing against the label actually rendered means a page is enqueued
 * exactly once per rename, and a second pass finds nothing.
 */
export async function findStaleReferrers(
  prisma: PrismaClient,
  pageId: string,
  title: string,
): Promise<string[]> {
  const rows = await prisma.blockIndex.findMany({
    where: {
      targetPageId: pageId,
      kind: "PAGE_LINK",
      // A trashed page renders nowhere; rebuilding it would be wasted work.
      page: { deletedAt: null },
    },
    select: { pageId: true, payload: true },
  });
  const stale = rows.filter((row) => refLabel(row.payload) !== title).map((row) => row.pageId);
  return [...new Set(stale)];
}

export interface Backlink {
  pageId: string;
  spaceId: bigint;
  title: string;
  slug: string;
  /** How many times this page links to the target. */
  count: number;
}

export interface Mention {
  pageId: string;
  spaceId: bigint;
  title: string;
  /** How many times this page mentions the user. */
  count: number;
  /** Page last-modified time — what "newest first" means here. */
  updatedAt: Date;
}

/**
 * Pages mentioning a user, newest first — what `target_user_id` is indexed for.
 *
 * Grouped by page: being named three times in one document is one thing to
 * look at, not three. Callers must still filter by read permission; a mention
 * does not grant access to the page it is in, and listing one the caller
 * cannot open would disclose its title.
 *
 * Scoped to a space when given one, because the surfaces that show this are
 * space-scoped routes (the same shape Recent and Starred use).
 */
export async function getMentions(
  prisma: PrismaClient,
  userId: bigint,
  spaceId?: bigint,
): Promise<Mention[]> {
  const rows = await prisma.blockIndex.findMany({
    where: {
      targetUserId: userId,
      kind: "MENTION",
      page: {
        deletedAt: null,
        space: { deletedAt: null },
        ...(spaceId === undefined ? {} : { spaceId }),
      },
    },
    select: {
      pageId: true,
      page: { select: { spaceId: true, title: true, updatedAt: true } },
    },
  });

  const grouped = new Map<string, Mention>();
  for (const row of rows) {
    const existing = grouped.get(row.pageId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(row.pageId, {
      pageId: row.pageId,
      spaceId: row.page.spaceId,
      title: row.page.title,
      count: 1,
      updatedAt: row.page.updatedAt,
    });
  }

  return [...grouped.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Which live pages link to this one — the query the index exists for.
 *
 * Grouped by source page: three links to the same target from one document are
 * one backlink with a count, not three entries. Callers must still filter the
 * result by read permission; knowing that a page you cannot open links to
 * yours leaks its title.
 */
export async function getBacklinks(prisma: PrismaClient, pageId: string): Promise<Backlink[]> {
  const rows = await prisma.blockIndex.findMany({
    where: {
      targetPageId: pageId,
      kind: "PAGE_LINK",
      // A trashed space leaves every listing (Wave E3), and its pages go with
      // it — so a backlink from inside one must not reappear here.
      page: { deletedAt: null, space: { deletedAt: null } },
      // A page linking to itself is not a backlink worth showing.
      NOT: { pageId },
    },
    select: {
      pageId: true,
      page: { select: { spaceId: true, title: true, slug: true, updatedAt: true } },
    },
  });

  const grouped = new Map<string, Backlink & { updatedAt: Date }>();
  for (const row of rows) {
    const existing = grouped.get(row.pageId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(row.pageId, {
      pageId: row.pageId,
      spaceId: row.page.spaceId,
      title: row.page.title,
      slug: row.page.slug,
      count: 1,
      updatedAt: row.page.updatedAt,
    });
  }

  return [...grouped.values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(({ updatedAt: _updatedAt, ...backlink }) => backlink);
}
