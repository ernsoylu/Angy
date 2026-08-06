import { Redis } from "ioredis";
import { getPrisma } from "@angy/db";
import { DOC_COMMAND_CHANNEL, type RewriteMediaCommand } from "@angy/shared";
import { env } from "./env.js";
import { deleteObject, getObject, putObject } from "./s3.js";

const bareUrl = (key: string) => `${env.s3.endpoint}/${env.s3.bucket}/${key}`;
const docSrcFor = (key: string) =>
  key.startsWith("media-private/") ? `/media/${key}` : bareUrl(key);

let pub: Redis | undefined;

function publisher(): Redis {
  pub ??= new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  return pub;
}

/**
 * Re-emit a page's media URL forms after a cross-visibility move (ADR 0007):
 * move each attachment object (and thumbnail) to the storage prefix matching
 * the new space's visibility, update the rows, then hand realtime a src
 * mapping so embedded image nodes get rewritten in the live doc.
 */
export async function reemitMediaForPage(pageId: string): Promise<void> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { space: true } });
  if (!page) return;
  const desired = page.space.visibility === "PRIVATE" ? "media-private" : "media";

  const attachments = await prisma.attachment.findMany({
    where: { pageId, deletedAt: null },
  });
  const mappings: { from: string; to: string }[] = [];

  for (const attachment of attachments) {
    const currentPrefix = attachment.s3Key.split("/")[0];
    if (currentPrefix === desired) continue;

    const newKey = `${desired}/${attachment.sha256}`;
    const bytes = await getObject(attachment.s3Key);
    if (!bytes) continue;
    await putObject(newKey, bytes);

    let newThumbKey: string | null = null;
    if (attachment.thumbnailS3Key) {
      const thumb = await getObject(attachment.thumbnailS3Key);
      if (thumb) {
        newThumbKey = `${newKey}.thumb.webp`;
        await putObject(newThumbKey, thumb);
      }
    }

    await prisma.attachment.update({
      where: { id: attachment.id },
      data: { s3Key: newKey, ...(newThumbKey && { thumbnailS3Key: newThumbKey }) },
    });
    await deleteObject(attachment.s3Key).catch(() => undefined);
    if (attachment.thumbnailS3Key) {
      await deleteObject(attachment.thumbnailS3Key).catch(() => undefined);
    }

    mappings.push({ from: docSrcFor(attachment.s3Key), to: docSrcFor(newKey) });
    console.log(`[worker] media re-emit: ${attachment.s3Key} -> ${newKey}`);
  }

  if (mappings.length > 0) {
    const command: RewriteMediaCommand = { type: "rewrite-media", pageId, mappings };
    await publisher().publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));
  }
}
