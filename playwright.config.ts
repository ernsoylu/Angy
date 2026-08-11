import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * E2E suite (CLAUDE.md § Testing): runs against the local stack —
 * `pnpm docker:up` + `pnpm dev` must be running. The global setup RESEEDS the
 * dev database, so anything you were hand-testing will be reset.
 */

/**
 * Every app loads the root .env.local (docs/env.md); the suite has to read the
 * same file or it addresses different services than the apps under test.
 * `global-setup` and `helpers` both fall back to `redis://localhost:6379`, so
 * without this the sessions they plant land in whatever Redis happens to own
 * that port while the apps read the one .env.local names — the suite then fails
 * every test with a redirect to /signin and no hint as to why.
 *
 * Same mechanism the db seed already uses (`node --env-file-if-exists`), and it
 * leaves anything exported in the shell alone, so an override still wins.
 *
 * `__dirname`, not `import.meta`: the root package.json has no `"type":
 * "module"`, so Playwright loads this config as CommonJS.
 */
const envFile = join(__dirname, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The suite shares one seeded backend — tests must not race each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
