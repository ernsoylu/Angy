import { PutBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { getPrisma } from "@angy/db";
import { env } from "./env.js";
import { getObject, putObject } from "./s3.js";

const THUMB_WIDTH = 480;

/** Thumbnails inherit the source key's access-class prefix. */
export const thumbnailKey = (sourceS3Key: string) => `${sourceS3Key}.thumb.webp`;

/**
 * Public-space media is served via bare immutable sha256 URLs (ADR 0007) —
 * in dev that means an anonymous-read bucket policy scoped to media/*.
 * Private-space access never relies on this: those URLs are signed.
 */
export async function ensurePublicMediaPolicy(): Promise<void> {
  const client = new S3Client({
    endpoint: env.s3.endpoint,
    region: env.s3.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.s3.accessKeyId,
      secretAccessKey: env.s3.secretAccessKey,
    },
  });
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: env.s3.bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${env.s3.bucket}/media/*`],
          },
        ],
      }),
    }),
  );
}

/** Generate a webp thumbnail for an image attachment and record its key + dimensions. */
export async function generateThumbnail(attachmentId: bigint): Promise<void> {
  const prisma = getPrisma();
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.deletedAt || !attachment.mimeType.startsWith("image/")) return;

  const bytes = await getObject(attachment.s3Key);
  if (!bytes) return;

  const image = sharp(Buffer.from(bytes));
  const meta = await image.metadata();
  const thumb = await image
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  const key = thumbnailKey(attachment.s3Key);
  await putObject(key, new Uint8Array(thumb));
  await prisma.attachment.update({
    where: { id: attachmentId },
    data: {
      thumbnailS3Key: key,
      width: meta.width ?? null,
      height: meta.height ?? null,
    },
  });
  console.log(`[worker] thumbnail for ${attachment.fileName} (${meta.width}×${meta.height})`);
}
