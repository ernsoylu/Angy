import { defineConfig } from "@playwright/test";

/**
 * E2E suite (CLAUDE.md § Testing): runs against the local stack —
 * `pnpm docker:up` + `pnpm dev` must be running. The global setup RESEEDS the
 * dev database, so anything you were hand-testing will be reset.
 */
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
