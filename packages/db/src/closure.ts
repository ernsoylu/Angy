import type { Page, Prisma, PrismaClient } from "@prisma/client";
import {
  pageAncestorInsert,
  pageBreadcrumb,
  pageMoveAttach,
  pageMoveDetach,
  pageSubtree,
} from "@prisma/client/sql";

export class PageMoveError extends Error {}

export interface CreatePageInput {
  spaceId: bigint;
  parentId?: string | null;
  title: string;
  slug: string;
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
    const page = await tx.page.create({
      data: {
        spaceId: input.spaceId,
        parentId: input.parentId ?? null,
        title: input.title,
        slug: input.slug,
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

/**
 * Move a page (with its whole subtree) under a new parent — or to the root
 * when newParentId is null. Closure-table delete+insert in one transaction
 * under a per-space advisory lock, with a cycle check (CLAUDE.md gotcha).
 */
export async function movePage(
  prisma: PrismaClient,
  pageId: string,
  newParentId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const page = await tx.page.findUnique({ where: { id: pageId } });
    if (!page) throw new PageMoveError("Page not found");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${page.spaceId})::text`;

    if (newParentId) {
      const parent = await tx.page.findFirst({
        where: { id: newParentId, spaceId: page.spaceId, deletedAt: null },
      });
      if (!parent) throw new PageMoveError("Destination page not found in this space");
      const wouldCycle = await tx.pageAncestor.findUnique({
        where: { ancestorId_descendantId: { ancestorId: pageId, descendantId: newParentId } },
      });
      if (wouldCycle) throw new PageMoveError("Cannot move a page into its own subtree");
    }

    await tx.$queryRawTyped(pageMoveDetach(pageId));
    if (newParentId) await tx.$queryRawTyped(pageMoveAttach(newParentId, pageId));
    await tx.page.update({ where: { id: pageId }, data: { parentId: newParentId } });
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
