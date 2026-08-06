import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

let client: S3Client | undefined;

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: env.s3.endpoint,
    region: env.s3.region,
    forcePathStyle: true, // MinIO
    credentials: {
      accessKeyId: env.s3.accessKeyId,
      secretAccessKey: env.s3.secretAccessKey,
    },
  });
  return client;
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    throw err;
  }
}
