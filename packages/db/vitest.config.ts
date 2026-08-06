import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/global-setup.ts",
    testTimeout: 30000,
    hookTimeout: 60000,
    // Advisory locks + interactive transactions across files must not race.
    fileParallelism: false,
  },
});
