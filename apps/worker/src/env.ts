import { config } from "dotenv";

config({ path: "../../.env.local", quiet: true });
config({ quiet: true });

export const env = {
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  meilisearch: {
    url: process.env.MEILISEARCH_URL ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_API_KEY ?? "masterKey",
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    /**
     * Browser-facing object-storage origin. The worker rewrites media URLs
     * *into documents*, where they outlive this process, so they must be the
     * public form even though every SDK call it makes uses `endpoint`.
     */
    publicEndpoint: () =>
      (process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? "http://localhost:9000")
        .replace(/\/+$/, ""),
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    bucket: process.env.S3_BUCKET ?? "angy-docs",
    region: process.env.S3_REGION ?? "us-east-1",
  },
};
