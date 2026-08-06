import { getPrisma } from "@angy/db";
import { chooseRevisionsToThin } from "@angy/shared";
import { deleteObject } from "./s3.js";
import { removeFromIndex } from "./search.js";

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const retentionMs = () => Number(process.env.TRASH_RETENTION_MS ?? DEFAULT_RETENTION_MS);
const thinAfterMs = () => Number(process.env.REVISION_THIN_AFTER_MS ?? DEFAULT_RETENTION_MS);

const swallow = (p: Promise<unknown>) => p.catch(() => undefined);

/**
 * Hard-delete one page: its S3 footprint (Y.Doc blob, revision blobs,
 * attachment objects + thumbnails), its rows (closure/permissions/revisions
 * cascade), and its search document. Idempotent.
 */
export async function hardDeletePage(pageId: string): Promise<void> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { revisions: true, attachments: true },
  });
  if (!page) return;

  for (const attachment of page.attachments) {
    await swallow(deleteObject(attachment.s3Key));
    if (attachment.thumbnailS3Key) await swallow(deleteObject(attachment.thumbnailS3Key));
  }
  for (const revision of page.revisions) {
    await swallow(deleteObject(revision.revisionS3Key));
  }
  if (page.ydocS3Key) await swallow(deleteObject(page.ydocS3Key));

  await prisma.attachment.deleteMany({ where: { pageId } });
  await prisma.page.delete({ where: { id: pageId } });
  await removeFromIndex(pageId);
  console.log(`[worker] hard-deleted page ${pageId} (${page.title})`);
}

/**
 * The 30-day sweep: pages trashed past retention are hard-deleted (leaf-first
 * so parent deletes never cascade past a child we haven't cleaned), then
 * soft-deleted attachments past retention get their objects swept too.
 */
export async function gcTrash(): Promise<{
  spaces: number;
  pages: number;
  attachments: number;
  revisions: number;
}> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - retentionMs());

  // Spaces first: hard-deleting one takes its pages with it, so doing this
  // before the page sweep saves walking pages that are about to disappear.
  const expiredSpaces = await prisma.space.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, key: true },
  });
  for (const space of expiredSpaces) await hardDeleteSpace(space.id, space.key);

  const expired = await prisma.page.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const page of expired) {
    const depth = await prisma.pageAncestor.count({ where: { descendantId: page.id } });
    (page as { depth?: number }).depth = depth;
  }
  const ordered = (expired as { id: string; depth?: number }[]).sort(
    (a, b) => (b.depth ?? 0) - (a.depth ?? 0),
  );
  for (const page of ordered) await hardDeletePage(page.id);

  const orphaned = await prisma.attachment.findMany({
    where: { deletedAt: { lt: cutoff } },
  });
  for (const attachment of orphaned) {
    await swallow(deleteObject(attachment.s3Key));
    if (attachment.thumbnailS3Key) await swallow(deleteObject(attachment.thumbnailS3Key));
  }
  await prisma.attachment.deleteMany({ where: { id: { in: orphaned.map((a) => a.id) } } });

  const thinned = await thinRevisions();
  return {
    spaces: expiredSpaces.length,
    pages: ordered.length,
    attachments: orphaned.length,
    revisions: thinned,
  };
}

/**
 * Hard-delete a space past retention: every page goes through the normal page
 * path (S3 objects, rows, search documents) leaf-first, then the space row
 * itself. Idempotent.
 */
export async function hardDeleteSpace(spaceId: bigint, key: string): Promise<void> {
  const prisma = getPrisma();
  const pages = await prisma.page.findMany({ where: { spaceId }, select: { id: true } });
  const withDepth: { id: string; depth: number }[] = [];
  for (const page of pages) {
    withDepth.push({
      id: page.id,
      depth: await prisma.pageAncestor.count({ where: { descendantId: page.id } }),
    });
  }
  // Leaf-first, so a parent delete never cascades past a child we have not
  // cleaned up yet (same ordering the page sweep uses).
  withDepth.sort((a, b) => b.depth - a.depth);
  for (const page of withDepth) await hardDeletePage(page.id);

  await prisma.spaceMember.deleteMany({ where: { spaceId } });
  await prisma.space.delete({ where: { id: spaceId } });
  console.log(`[worker] hard-deleted space ${spaceId} (${key}) and ${pages.length} page(s)`);
}

/**
 * Revision thinning (ADR 0006): past the retention window, keep one revision
 * per day per page — blobs and rows for the rest are deleted. The policy
 * itself is pure and unit-tested in @angy/shared.
 */
export async function thinRevisions(): Promise<number> {
  const prisma = getPrisma();
  const pages = await prisma.pageRevision.findMany({
    distinct: ["pageId"],
    select: { pageId: true },
  });
  let deleted = 0;
  for (const { pageId } of pages) {
    const revisions = await prisma.pageRevision.findMany({
      where: { pageId },
      select: { version: true, createdAt: true, revisionS3Key: true },
    });
    const doomed = new Set(
      chooseRevisionsToThin(
        revisions.map((r) => ({ version: r.version, createdAt: r.createdAt.toISOString() })),
        new Date(),
        thinAfterMs(),
      ),
    );
    if (doomed.size === 0) continue;
    for (const revision of revisions) {
      if (doomed.has(revision.version)) await swallow(deleteObject(revision.revisionS3Key));
    }
    await prisma.pageRevision.deleteMany({
      where: { pageId, version: { in: [...doomed] } },
    });
    deleted += doomed.size;
    console.log(`[worker] thinned ${doomed.size} old revision(s) on ${pageId}`);
  }
  return deleted;
}
