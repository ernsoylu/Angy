import { config } from "dotenv";

// Root .env.local carries the local-dev defaults (see docs/env.md).
config({ path: "../../.env.local", quiet: true });
config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see docs/env.md)`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  oidc: {
    issuerUrl: () => required("OIDC_ISSUER_URL"),
    clientId: () => required("OIDC_CLIENT_ID"),
    clientSecret: () => required("OIDC_CLIENT_SECRET"),
  },
  jwtSecret: () => required("JWT_SECRET"),
  meilisearch: {
    url: process.env.MEILISEARCH_URL ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_API_KEY ?? "masterKey",
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    bucket: process.env.S3_BUCKET ?? "angy-docs",
    region: process.env.S3_REGION ?? "us-east-1",
  },
};
