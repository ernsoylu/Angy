import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { Redis } from "ioredis";

/** Sessions planted by global-setup, shared by the whole suite. */
export type SessionName = "e2e-mira" | "e2e-ada" | "e2e-eren";

/** Seeded user ids (deterministic: mira=1 … eren=5). */
export const SEEDED_USER_ID = { mira: 1, ada: 4, eren: 5 } as const;

/**
 * Mint a throwaway session for a seeded user. Sign-out tests must use one of
 * these: signing out destroys the session key, and burning a shared one leaves
 * every later test that needs it depending on file order.
 */
export async function plantSession(name: string, userId: number): Promise<string> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  await redis.set(`session:${name}`, String(userId), "EX", 7200);
  redis.disconnect();
  return name;
}

/** A browser context authenticated as one of the seeded users. */
export async function sessionContext(
  browser: Browser,
  session: SessionName | (string & {}),
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "angy_session", value: session, domain: "localhost", path: "/" },
  ]);
  return context;
}

const API = "http://localhost:3001";

/** Call the REST API as a seeded user (test setup/teardown, not UI under test). */
export async function api<T>(
  session: SessionName,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      cookie: `angy_session=${session}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!body.success) throw new Error(body.error?.message ?? `API ${path} failed`);
  return body.data;
}

/**
 * The rendered article body — always use this, never a bare `.article-prose`.
 *
 * The reader is streamed (RSC), so for a moment after a navigation the DOM
 * holds *two* `.article-prose` nodes: the one in place, and a second copy
 * inside React's hidden streaming template (`<div hidden id="S:…">`) before it
 * is moved into position. A strict locator that resolves inside that window
 * dies with "resolved to 2 elements", and the assertion it was about never
 * runs — so the failure names whichever spec happened to sample mid-swap and
 * says nothing about the code.
 *
 * Measured at 2 in 40 navigations locally, which is why the victim rotated
 * between runs (authoring, collab, history) and why one CI provider could be
 * green on the same commit another failed: the window is a race, so the answer
 * depends on how fast the machine streams.
 *
 * `:visible` rather than `.first()`: the template is hidden by definition, so
 * this narrows to the real article without also swallowing a genuine duplicate
 * — if the page ever renders two visible bodies, this still fails loudly.
 */
export function articleBody(page: Page): Locator {
  return page.locator(".article-prose:visible");
}

/**
 * The reader's page title. Same streaming race as `articleBody`, same fix, and
 * for the same reason: `page.locator("h1")` resolves to two elements while the
 * hidden template is still in the DOM, and the spec that samples mid-swap dies
 * with "resolved to 2 elements" no matter what it was actually asserting.
 *
 * The window widens with everything the page streams *after* the title, so
 * specs that were reliable before a rail group was added are not evidence that
 * a bare locator was ever safe — H5 added three (comments, properties, the
 * database table) and the trap fired on the next run.
 */
export function pageTitle(page: Page): Locator {
  return page.locator("h1:visible");
}

export async function pageIdBySlug(session: SessionName, slug: string): Promise<string> {
  const pages = await api<{ id: string; slug: string }[]>(session, "/spaces/1/pages");
  const page = pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page with slug ${slug}`);
  return page.id;
}
