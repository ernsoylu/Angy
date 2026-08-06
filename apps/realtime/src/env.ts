import { config } from "dotenv";

config({ path: "../../.env.local", quiet: true });
config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see docs/env.md)`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3002),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: () => required("JWT_SECRET"),
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    bucket: process.env.S3_BUCKET ?? "angy-docs",
    region: process.env.S3_REGION ?? "us-east-1",
  },
};
