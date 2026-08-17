import type { PrismaClient } from "@prisma/client";

/**
 * Comment threads (V2 H5.2, ADR 0014). The anchor lives in the Y.Doc as a
 * `comment` mark; these are the parts a document should not carry.
 */

/**
 * Reconcile threads against the anchors actually present in a page's document.
 *
 * Called from `rebuildProjection`, which already has the document in hand, so
 * this inherits that job's rebuild trigger, reconciliation sweep and
 * idempotency — the same reasoning that put `block_index` there.
 *
 * A thread whose mark is gone is flagged rather than deleted: the sentence was
 * removed, the conversation about it usually still matters, and the rail says
 * so. The reverse runs too, because an undo or a revision restore can bring
 * the text back, and a thread that came back should stop apologising for
 * itself.
 */
export async function syncCommentAnchors(
  prisma: PrismaClient,
  pageId: string,
  anchoredThreadIds: readonly string[],
): Promise<{ orphaned: number; revived: number }> {
  const anchored = [...new Set(anchoredThreadIds)];

  const [orphaned, revived] = await Promise.all([
    prisma.commentThread.updateMany({
      where: { pageId, orphanedAt: null, id: { notIn: anchored } },
      data: { orphanedAt: new Date() },
    }),
    anchored.length === 0
      ? { count: 0 }
      : prisma.commentThread.updateMany({
          where: { pageId, orphanedAt: { not: null }, id: { in: anchored } },
          data: { orphanedAt: null },
        }),
  ]);

  return { orphaned: orphaned.count, revived: revived.count };
}

/**
 * Who should hear about a new remark: everyone already in the thread, plus the
 * page's last editor — the closest thing a wiki has to the person who will
 * care — minus whoever is doing the talking.
 *
 * The notification row is keyed `(user, kind, page)`, so ten comments on one
 * page collapse into one inbox item. That is the judgement mentions already
 * made: being named three times in one document is one thing to look at.
 */
export async function commentAudience(
  prisma: PrismaClient,
  threadId: string,
  actorId: bigint,
): Promise<bigint[]> {
  const thread = await prisma.commentThread.findUnique({
    where: { id: threadId },
    include: {
      comments: { where: { deletedAt: null }, select: { authorId: true } },
      page: { select: { createdBy: true, updatedBy: true } },
    },
  });
  if (!thread) return [];

  const audience = new Set<bigint>([
    thread.createdBy,
    ...thread.comments.map((comment) => comment.authorId),
    thread.page.updatedBy ?? thread.page.createdBy,
  ]);
  audience.delete(actorId);
  return [...audience];
}

/** Inbox rows for a new comment. Idempotent through the same unique key. */
export async function raiseCommentNotifications(
  prisma: PrismaClient,
  pageId: string,
  userIds: readonly bigint[],
  actorId: bigint,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const result = await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      kind: "COMMENT" as const,
      pageId,
      actorId,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
