import type { Browser, BrowserContext } from "@playwright/test";

export type SessionName = "e2e-mira" | "e2e-ada" | "e2e-eren";

/** A browser context authenticated as one of the seeded users. */
export async function sessionContext(
  browser: Browser,
  session: SessionName,
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

export async function pageIdBySlug(session: SessionName, slug: string): Promise<string> {
  const pages = await api<{ id: string; slug: string }[]>(session, "/spaces/1/pages");
  const page = pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No page with slug ${slug}`);
  return page.id;
}
