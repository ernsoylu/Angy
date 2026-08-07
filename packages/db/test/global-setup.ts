import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://user:password@localhost:5432/postgres";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://user:password@localhost:5432/angy_test";

/** Recreate the angy_test database and push the current schema into it. */
export default async function setup() {
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS angy_test WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE angy_test`);
  } finally {
    await admin.$disconnect();
  }
  execSync("pnpm exec prisma db push --skip-generate", { // NOSONAR — test-only; resolving pnpm via PATH is intentional (docs/runbooks/homelab.md §7)
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "inherit",
  });
}
