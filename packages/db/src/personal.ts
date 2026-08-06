import type { PrismaClient } from "@prisma/client";
import { recordPageVisit as recordPageVisitSql } from "@prisma/client/sql";

/** A visit inside this window is treated as already recorded. */
export const VISIT_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Mark a page as read by a user. Safe to call on every reader render — the
 * write is throttled inside Postgres (see prisma/sql/recordPageVisit.sql), so
 * repeated renders cost one indexed upsert attempt and nothing else.
 *
 * @returns whether a row was actually written.
 */
export async function recordPageVisit(
  prisma: PrismaClient,
  userId: bigint,
  pageId: string,
  throttleMs: number = VISIT_THROTTLE_MS,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - throttleMs);
  const written = await prisma.$queryRawTyped(recordPageVisitSql(userId, pageId, staleBefore));
  return written.length > 0;
}

export async function isPageStarred(
  prisma: PrismaClient,
  userId: bigint,
  pageId: string,
): Promise<boolean> {
  const star = await prisma.pageStar.findUnique({
    where: { userId_pageId: { userId, pageId } },
  });
  return star !== null;
}
