import "server-only";
import { config } from "dotenv";
import {
  filterReadablePages,
  getBacklinks,
  getBreadcrumb,
  getDatabaseView,
  getEffectivePageLevel,
  getPageValues,
  getPrisma,
  isPageStarred,
  recordPageVisit,
} from "@angy/db";
import { satisfies, type CommentThreadDto, type PermLevelDto } from "@angy/shared";

// The read path (CLAUDE.md): RSC streams rendered_html from Postgres directly —
// no API hop for page content. Auth and the page tree stay on the REST API.
config({ path: `${process.cwd()}/../../.env.local`, quiet: true });

export interface ReaderPage {
  id: string;
  spaceId: bigint;
  title: string;
  renderedHtml: string | null;
  breadcrumb: { id: string; title: string }[];
  version: number | null;
  updatedByName: string | null;
  contributors: number;
  /** Whether the caller has starred this page (Wave C). */
  starred: boolean;
  /** Workspace-wide tag names, in the order they were added (Wave D). */
  tags: string[];
  /** The caller's effective level — the reader shows EDIT-gated affordances. */
  level: PermLevelDto | null;
  updatedAt: string;
}

/**
 * Load a page for the read path, enforcing the caller's effective permission
 * (space baseline ∪ page grants). "forbidden" renders the restricted state.
 */
export async function getReaderPage(
  pageId: string,
  userId: bigint,
  required: PermLevelDto = "VIEW",
): Promise<ReaderPage | "forbidden" | null> {
  if (!/^[0-9a-f-]{36}$/.test(pageId)) return null;
  const prisma = getPrisma();
  const page = await prisma.page.findFirst({ where: { id: pageId, deletedAt: null } });
  if (!page) return null;
  const level = await getEffectivePageLevel(prisma, userId, pageId);
  if (!satisfies(level, required)) return "forbidden";

  const [breadcrumb, latestRevision, contributors, editor, starred, tags] = await Promise.all([
    getBreadcrumb(prisma, page.id),
    prisma.pageRevision.findFirst({ where: { pageId: page.id }, orderBy: { version: "desc" } }),
    prisma.pageRevision.findMany({
      where: { pageId: page.id },
      distinct: ["createdBy"],
      select: { createdBy: true },
    }),
    prisma.appUser.findUnique({ where: { id: page.updatedBy ?? page.createdBy } }),
    isPageStarred(prisma, userId, pageId),
    prisma.pageTag.findMany({
      where: { pageId },
      select: { tag: { select: { name: true } } },
      orderBy: { addedAt: "asc" },
    }),
  ]);

  return {
    id: page.id,
    spaceId: page.spaceId,
    title: page.title,
    renderedHtml: page.renderedHtml,
    breadcrumb: breadcrumb.map((row) => ({ id: row.id, title: row.title })),
    version: latestRevision?.version ?? null,
    updatedByName: editor?.displayName ?? null,
    contributors: Math.max(contributors.length, 1),
    starred,
    tags: tags.map((row) => row.tag.name),
    level,
    updatedAt: page.updatedAt.toISOString(),
  };
}

export interface ReaderBacklink {
  id: string;
  title: string;
  /** How many times that page links here. */
  count: number;
  /** Set only when the referring page lives in a *different* space. */
  spaceName: string | null;
}

/** How many backlinks the rail lists before collapsing the rest into a count. */
export const BACKLINK_LIMIT = 8;

/**
 * Pages linking to this one (V2 H1), filtered to those the caller may read.
 *
 * A backlink names a page and its title, so VIEW on the *target* is not
 * enough — the filter is what stops a private page's existence leaking through
 * the rail of a public one. Filtering happens before the limit is applied, so
 * the "and N more" count never includes pages the reader could not open.
 */
export async function getReaderBacklinks(
  pageId: string,
  userId: bigint,
  spaceId: bigint,
): Promise<{ shown: ReaderBacklink[]; hidden: number }> {
  const prisma = getPrisma();
  const candidates = await getBacklinks(prisma, pageId);
  if (candidates.length === 0) return { shown: [], hidden: 0 };

  const readable = await filterReadablePages(
    prisma,
    userId,
    candidates.map((link) => link.pageId),
  );
  const visible = candidates.filter((link) => readable.has(link.pageId));

  // Only cross-space backlinks name their space; labelling every row with the
  // space the reader is already in would be noise.
  const foreign = [...new Set(visible.filter((l) => l.spaceId !== spaceId).map((l) => l.spaceId))];
  const spaces = new Map(
    foreign.length === 0
      ? []
      : (await prisma.space.findMany({ where: { id: { in: foreign } } })).map((space) => [
          space.id,
          space.name,
        ]),
  );

  return {
    shown: visible.slice(0, BACKLINK_LIMIT).map((link) => ({
      id: link.pageId,
      title: link.title,
      count: link.count,
      spaceName: link.spaceId === spaceId ? null : (spaces.get(link.spaceId) ?? null),
    })),
    hidden: Math.max(0, visible.length - BACKLINK_LIMIT),
  };
}

/**
 * Comment threads on a page (V2 H5.2), server-rendered with the rail.
 *
 * Call only after `getReaderPage` has cleared permissions: a thread is exactly
 * as readable as the page it hangs off (ADR 0014), so there is no second check
 * to make here.
 *
 * Resolved threads come back too — the rail hides them behind a count, and the
 * highlight styling needs to know which anchors have stopped being live.
 */
export async function getReaderThreads(pageId: string): Promise<CommentThreadDto[]> {
  const threads = await getPrisma().commentThread.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    include: {
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { displayName: true } } },
      },
    },
  });

  const resolverIds = [...new Set(threads.flatMap((t) => (t.resolvedBy ? [t.resolvedBy] : [])))];
  const resolvers = new Map(
    resolverIds.length === 0
      ? []
      : (
          await getPrisma().appUser.findMany({
            where: { id: { in: resolverIds } },
            select: { id: true, displayName: true },
          })
        ).map((user) => [user.id.toString(), user.displayName] as const),
  );

  return threads.map((thread) => ({
    id: thread.id,
    pageId: thread.pageId,
    anchorText: thread.anchorText,
    createdAt: thread.createdAt.toISOString(),
    resolved: thread.resolvedAt !== null,
    resolvedByName: thread.resolvedBy
      ? (resolvers.get(thread.resolvedBy.toString()) ?? null)
      : null,
    orphaned: thread.orphanedAt !== null,
    comments: thread.comments.map((comment) => ({
      id: comment.id.toString(),
      authorId: comment.authorId.toString(),
      authorName: comment.author.displayName,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt?.toISOString() ?? null,
    })),
  }));
}

/**
 * Everything the property model puts on a page (V2 H5.3): the space's
 * vocabulary, this page's own values, and — if it has been configured as one —
 * the database view over its children.
 *
 * Server-rendered like the rest of the reader: the table is already filtered
 * and sorted by the time the page streams, so a view ships no JavaScript.
 * Called after `getReaderPage` has cleared permissions; rows are children of a
 * readable page, and page grants only ever widen access, so a child of a page
 * you can read is a page you can read.
 */
export async function getReaderDatabase(pageId: string, spaceId: bigint, userId: bigint) {
  const prisma = getPrisma();
  const [properties, values, view] = await Promise.all([
    prisma.pageProperty.findMany({
      where: { spaceId },
      orderBy: [{ ord: "asc" }, { id: "asc" }],
    }),
    getPageValues(prisma, pageId),
    // The rows are *other* pages, and access to this one does not extend to
    // its children — the view filters per caller.
    getDatabaseView(prisma, pageId, userId),
  ]);

  return {
    properties: properties.map((property) => ({
      id: property.id.toString(),
      name: property.name,
      type: property.type,
      options: property.options,
    })),
    values,
    view,
  };
}

/**
 * Record a read for the Recent list. Call only after getReaderPage has cleared
 * permissions — this writes without re-checking. Failures are swallowed:
 * reading history is never worth failing a page render over.
 */
export async function recordVisit(pageId: string, userId: bigint): Promise<void> {
  try {
    await recordPageVisit(getPrisma(), userId, pageId);
  } catch {
    /* history is best-effort */
  }
}
