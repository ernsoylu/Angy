import type { Page, Prisma, PrismaClient } from "@prisma/client";
import {
  pageAncestorInsert,
  pageBreadcrumb,
  pageMoveAttach,
  pageMoveDetach,
  pageSubtree,
} from "@prisma/client/sql";
import { orderKeyBetween } from "@angy/shared";

export class PageMoveError extends Error {}

/**
 * Sibling group of a page: children share a parent, roots share a space
 * (`parent_id` is null for all of them and cannot serve as the group key).
 * Trashed siblings are deliberately included — a trashed page keeps its place
 * so that restoring it puts it back where it was, and a new page that reused
 * its key would land on top of it.
 */
function siblingWhere(spaceId: bigint, parentId: string | null) {
  return { spaceId, parentId };
}

/** The key that appends to the end of a sibling group. */
async function appendOrd(
  tx: Prisma.TransactionClient,
  spaceId: bigint,
  parentId: string | null,
): Promise<string> {
  const last = await tx.page.findFirst({
    where: siblingWhere(spaceId, parentId),
    orderBy: [{ ord: "desc" }, { id: "desc" }],
    select: { ord: true },
  });
  return orderKeyBetween(last?.ord ?? null, null);
}

export interface CreatePageInput {
  /**
   * Assigned by the caller instead of the database. Import needs it: a
   * document that links to its siblings can only be rewritten once every id in
   * the bundle is known, and `document_json` is written at create time — so
   * the ids have to exist before the first page does.
   */
  id?: string;
  spaceId: bigint;
  parentId?: string | null;
  title: string;
  slug: string;
  /**
   * Place among siblings. Left out, the page appends to the end of its group,
   * which costs one extra query; a caller that already knows the whole
   * sequence can pass keys from `orderKeysAfter` and skip it.
   */
  ord?: string;
  createdBy: bigint;
  documentJson?: Prisma.InputJsonValue;
  renderedHtml?: string;
  textExtract?: string;
}

/**
 * Create a page and register it in the page_ancestor closure table in one
 * transaction. Roots pass their own id to the closure insert — the ancestor
 * SELECT matches nothing and only the self-row (depth 0) is written.
 */
export async function createPage(prisma: PrismaClient, input: CreatePageInput): Promise<Page> {
  return prisma.$transaction(async (tx) => {
    const ord = input.ord ?? (await appendOrd(tx, input.spaceId, input.parentId ?? null));
    const page = await tx.page.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        spaceId: input.spaceId,
        parentId: input.parentId ?? null,
        title: input.title,
        slug: input.slug,
        ord,
        createdBy: input.createdBy,
        documentJson: input.documentJson,
        renderedHtml: input.renderedHtml,
        textExtract: input.textExtract,
      },
    });
    await tx.$queryRawTyped(pageAncestorInsert(input.parentId ?? page.id, page.id));
    return page;
  });
}

/** All live pages under a root (inclusive), shallowest first. */
export function getSubtree(prisma: PrismaClient, rootId: string) {
  return prisma.$queryRawTyped(pageSubtree(rootId));
}

/** Ancestor chain for a page, root first, ending at the page itself. */
export function getBreadcrumb(prisma: PrismaClient, pageId: string) {
  return prisma.$queryRawTyped(pageBreadcrumb(pageId));
}

export interface MoveResult {
  /** Every page in the moved subtree, root included. */
  movedIds: string[];
  spaceChanged: boolean;
  /** True when the move crossed a visibility class — media must be re-emitted (ADR 0007). */
  visibilityChanged: boolean;
  targetSpaceId: bigint;
}

/**
 * Move a page (with its whole subtree) under a new parent, to the root of its
 * own space, or into another space entirely. Closure-table delete+insert in
 * one transaction under per-space advisory locks (taken in ascending order to
 * avoid deadlocks), with a cycle check (CLAUDE.md gotcha). Cross-space moves
 * carry the subtree's space_id along and de-duplicate colliding slugs.
 */
export async function movePage(
  prisma: PrismaClient,
  pageId: string,
  newParentId: string | null,
  targetSpaceIdForRoot?: bigint,
): Promise<MoveResult> {
  return prisma.$transaction(async (tx) => {
    const page = await tx.page.findUnique({ where: { id: pageId }, include: { space: true } });
    if (!page) throw new PageMoveError("Page not found");

    let parent = null;
    if (newParentId) {
      parent = await tx.page.findFirst({
        where: { id: newParentId, deletedAt: null },
      });
      if (!parent) throw new PageMoveError("Destination page not found");
    }
    const targetSpaceId = parent?.spaceId ?? targetSpaceIdForRoot ?? page.spaceId;
    const targetSpace = await tx.space.findUnique({ where: { id: targetSpaceId } });
    if (!targetSpace) throw new PageMoveError("Destination space not found");

    for (const spaceId of [...new Set([page.spaceId, targetSpaceId])].sort((a, b) =>
      a < b ? -1 : 1,
    )) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${spaceId})::text`;
    }

    if (newParentId) {
      const wouldCycle = await tx.pageAncestor.findUnique({
        where: { ancestorId_descendantId: { ancestorId: pageId, descendantId: newParentId } },
      });
      if (wouldCycle) throw new PageMoveError("Cannot move a page into its own subtree");
    }

    await tx.$queryRawTyped(pageMoveDetach(pageId));
    if (newParentId) await tx.$queryRawTyped(pageMoveAttach(newParentId, pageId));

    const subtree = await tx.pageAncestor.findMany({
      where: { ancestorId: pageId },
      select: { descendantId: true },
    });
    const movedIds = subtree.map((row) => row.descendantId);

    const spaceChanged = targetSpaceId !== page.spaceId;
    if (spaceChanged) {
      const taken = new Set(
        (
          await tx.page.findMany({ where: { spaceId: targetSpaceId }, select: { slug: true } })
        ).map((p) => p.slug),
      );
      const moving = await tx.page.findMany({
        where: { id: { in: movedIds } },
        select: { id: true, slug: true },
      });
      for (const m of moving) {
        if (taken.has(m.slug)) {
          let i = 2;
          let slug = `${m.slug}-${i}`;
          while (taken.has(slug)) slug = `${m.slug}-${++i}`;
          await tx.page.update({ where: { id: m.id }, data: { slug } });
          taken.add(slug);
        } else {
          taken.add(m.slug);
        }
      }
      await tx.page.updateMany({
        where: { id: { in: movedIds } },
        data: { spaceId: targetSpaceId },
      });
    }
    // The moved page joins a new sibling group at its end; its descendants
    // keep their keys, because their parent — and so their group — is the
    // same one it always was.
    await tx.page.update({
      where: { id: pageId },
      data: { parentId: newParentId, ord: await appendOrd(tx, targetSpaceId, newParentId) },
    });

    return {
      movedIds,
      spaceChanged,
      visibilityChanged: spaceChanged && targetSpace.visibility !== page.space.visibility,
      targetSpaceId,
    };
  });
}

/**
 * Reorder a page **within its own sibling group** — `afterId` is the sibling
 * it should follow, or null to put it first.
 *
 * Deliberately not a reparent: moving a page to a different parent rewrites
 * the closure table, re-checks permissions in the destination space and can
 * re-emit media, all of which `movePage` already does under an advisory lock.
 * A reorder is one row update and nothing else, and keeping the two apart is
 * what makes that true.
 *
 * Neighbours come from the *live* siblings, because those are the ones the
 * caller could see. Ties (two siblings sharing a key, which concurrent inserts
 * can produce) are stepped over rather than treated as an error: the ordering
 * everywhere is `(ord, id)`, so a tie is a resolved ordering, not a broken one.
 */
export async function reorderPage(
  prisma: PrismaClient,
  pageId: string,
  afterId: string | null,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const page = await tx.page.findUnique({ where: { id: pageId } });
    if (!page) throw new PageMoveError("Page not found");
    if (afterId === pageId) throw new PageMoveError("A page cannot follow itself");

    const siblings = await tx.page.findMany({
      where: { ...siblingWhere(page.spaceId, page.parentId), deletedAt: null, id: { not: pageId } },
      orderBy: [{ ord: "asc" }, { id: "asc" }],
      select: { id: true, ord: true },
    });

    let index = 0;
    if (afterId !== null) {
      const at = siblings.findIndex((sibling) => sibling.id === afterId);
      if (at < 0) throw new PageMoveError("Anchor page is not a sibling of this page");
      index = at + 1;
    }

    const before = index > 0 ? siblings[index - 1].ord : null;
    const after =
      siblings.slice(index).find((sibling) => before === null || sibling.ord > before)?.ord ?? null;

    const ord = orderKeyBetween(before, after);
    await tx.page.update({ where: { id: pageId }, data: { ord } });
    return ord;
  });
}

/** Soft-delete a page and its whole subtree (30-day trash). Returns affected ids. */
export async function trashPage(
  prisma: PrismaClient,
  pageId: string,
  trashedBy: bigint,
): Promise<string[]> {
  const subtree = await prisma.pageAncestor.findMany({
    where: { ancestorId: pageId },
    select: { descendantId: true },
  });
  const ids = subtree.map((row) => row.descendantId);
  await prisma.page.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date(), updatedBy: trashedBy },
  });
  return ids;
}

/** Restore a trashed page and its subtree — its place in the tree was kept. */
export async function restorePage(prisma: PrismaClient, pageId: string): Promise<string[]> {
  const subtree = await prisma.pageAncestor.findMany({
    where: { ancestorId: pageId },
    select: { descendantId: true },
  });
  const ids = subtree.map((row) => row.descendantId);
  await prisma.page.updateMany({
    where: { id: { in: ids } },
    data: { deletedAt: null },
  });
  return ids;
}
