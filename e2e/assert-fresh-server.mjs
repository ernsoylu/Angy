#!/usr/bin/env node
/**
 * Refuse to run the e2e suite against a web server older than its own build.
 *
 * Next serves content-hashed chunks. Rebuild while a server is running and the
 * hashes on disk no longer match the ones its HTML references, so the client
 * JS 404s and every interactive test fails — dialogs never open, buttons do
 * nothing. The failures look like application bugs and are entirely an
 * artefact of process ordering.
 *
 * This has cost real time four separate times in this project, including once
 * where it produced sixteen simultaneous "failures" and once where it masked a
 * genuine fix as broken. Starting a replacement server without stopping the
 * old one is the usual cause: the new process cannot bind the port, exits, and
 * the stale one keeps serving.
 *
 * Comparing start time against BUILD_ID mtime catches it in a second, which is
 * cheaper than diagnosing it again.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildId = join(root, "apps/web/.next/BUILD_ID");

let builtAt;
try {
  builtAt = statSync(buildId).mtimeMs;
} catch {
  console.error("[e2e] apps/web/.next/BUILD_ID is missing — run `pnpm build` first.");
  process.exit(1);
}

// `ps` rather than a pidfile: the suite is routinely run against servers
// started by hand, by CI, or by a previous session, and none of them agree on
// where a pidfile would live.
let started = null;
try {
  // execFileSync, not execSync: no shell, so nothing here can be
  // reinterpreted as a command even if the argument list ever grows.
  const out = execFileSync("ps", ["-eo", "pid,lstart,cmd"], { encoding: "utf8" });
  for (const line of out.split("\n")) {
    if (!line.includes("next-server")) continue;
    const m = /^\s*\d+\s+(.{24})\s/.exec(line);
    if (m) started = Date.parse(m[1]);
  }
} catch {
  // No ps, or an unfamiliar format — skip rather than block the suite on a
  // diagnostic. The check is an early warning, not a gate on correctness.
  process.exit(0);
}

if (started === null || Number.isNaN(started)) process.exit(0);

if (started < builtAt) {
  const behind = Math.round((builtAt - started) / 1000);
  console.error(
    `\n[e2e] The web server started ${behind}s BEFORE the current build.\n` +
      "      It is serving chunk hashes that no longer exist, so interactive\n" +
      "      tests will fail for reasons that have nothing to do with the code.\n\n" +
      "      Stop it and start a new one:\n" +
      "        pkill -f next-server && pnpm --filter @angy/web start &\n",
  );
  process.exit(1);
}
