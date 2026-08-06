import { getPrisma } from "@angy/db";
import { deleteObject } from "./s3.js";
import { removeFromIndex } from "./search.js";

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const retentionMs = () => Number(process.env.TRASH_RETENTION_MS ?? DEFAULT_RETENTION_MS);

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
export async function gcTrash(): Promise<{ pages: number; attachments: number }> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - retentionMs());

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

  return { pages: ordered.length, attachments: orphaned.length };
}
