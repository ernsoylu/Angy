import { execSync } from "node:child_process";
import { Redis } from "ioredis";

/**
 * Reseed the dev database (deterministic ids: mira=1 … eren=5) and plant
 * session cookies for the test users directly in Redis — the OIDC round-trip
 * has its own coverage in the API layer.
 */
export default async function globalSetup() {
  for (const port of [3000, 3001, 3002]) {
    try {
      await fetch(`http://localhost:${port === 3000 ? "3000/signin" : `${port}/health`}`, {
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      if (port !== 3002) {
        throw new Error(
          `Service on :${port} is not responding — start the stack with pnpm docker:up && pnpm dev`,
        );
      }
    }
  }

  execSync("pnpm db:seed", { cwd: __dirname + "/..", stdio: "inherit" }); // NOSONAR — test-only; resolving pnpm via PATH is intentional (docs/runbooks/homelab.md §7)

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  await redis.set("session:e2e-mira", "1", "EX", 7200); // Mira Kalvo — Product admin
  await redis.set("session:e2e-ada", "4", "EX", 7200); // Ada Lund — VIEW-only in eng
  await redis.set("session:e2e-eren", "5", "EX", 7200); // Eren Soylu — eng admin
  redis.disconnect();

  // The seed queues projection rebuilds; wait until search reflects THIS seed
  // (the private Roadmap doc is the last thing tests depend on).
  const meiliUrl = process.env.MEILISEARCH_URL ?? "http://localhost:7700";
  const meiliKey = process.env.MEILISEARCH_API_KEY ?? "masterKey";
  const deadline = Date.now() + 60_000;
  for (;;) {
    const res = await fetch(`${meiliUrl}/indexes/pages/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${meiliKey}`, "content-type": "application/json" },
      body: JSON.stringify({ q: "Private space content" }),
    });
    const body = (await res.json()) as { hits?: { title: string }[] };
    if (body.hits?.some((hit) => hit.title === "Roadmap")) break;
    if (Date.now() > deadline) {
      throw new Error("Search index did not catch up with the seed — is the worker running?");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
