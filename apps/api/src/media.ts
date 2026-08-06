import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

/**
 * Media URL forms (ADR 0007), decided at serve time by space visibility:
 * public → bare immutable sha256 URL (max cacheability);
 * private → short-TTL signed URL minted per request.
 */

const SIGNED_URL_TTL_SECONDS = 300;

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

export async function putMediaObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Content-addressed keys never change content — cache forever.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export function bareMediaUrl(key: string): string {
  return `${env.s3.endpoint}/${env.s3.bucket}/${key}`;
}

export async function signedMediaUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

export async function mediaUrl(key: string, isPrivateSpace: boolean): Promise<string> {
  return isPrivateSpace ? signedMediaUrl(key) : bareMediaUrl(key);
}
