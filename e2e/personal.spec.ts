import { expect, test } from "@playwright/test";
import { SEEDED_USER_ID, api, pageIdBySlug, pageTitle, plantSession, sessionContext } from "./helpers";

/** Wave C: reading history, stars, and the surfaces built on them. */
test.describe("recent, starred and the Me tab", () => {
  test("reading a page fills Recent; the rail's star fills Starred", async ({ browser }) => {
    test.setTimeout(90_000);
    const pageId = await pageIdBySlug("e2e-eren", "storage-model");
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();

    // Reading is what populates Recent — no explicit action.
    await page.goto(`/s/eng/${pageId}`);
    await expect(pageTitle(page)).toHaveText("Storage Model");

    await page.getByRole("link", { name: "Recent" }).click();
    await expect(page).toHaveURL(/\/s\/eng\/recent$/);
    await expect(pageTitle(page)).toHaveText("Recent");
    await expect(page.getByRole("link", { name: /Storage Model/ })).toBeVisible();

    // Starred starts empty and says so, rather than rendering a blank panel.
    await page.getByRole("link", { name: "Starred" }).click();
    await expect(page.getByText("Nothing starred yet")).toBeVisible();

    // Star from the page-info rail.
    await page.goto(`/s/eng/${pageId}`);
    const star = page.getByRole("button", { name: "Star page" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(page.getByRole("button", { name: "Starred" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // It survives a reload (server state, not just optimistic UI) and lists.
    await page.reload();
    await expect(page.getByRole("button", { name: "Starred" })).toBeVisible();
    await page.goto("/s/eng/starred");
    await expect(page.getByRole("link", { name: /Storage Model/ })).toBeVisible();

    // Unstar removes it again.
    await page.goto(`/s/eng/${pageId}`);
    await page.getByRole("button", { name: "Starred" }).click();
    await expect(page.getByRole("button", { name: "Star page" })).toBeVisible();
    await page.goto("/s/eng/starred");
    await expect(page.getByText("Nothing starred yet")).toBeVisible();

    await context.close();
  });

  test("the mobile Me tab shows the profile, both lists, and signs out", async ({ browser }) => {
    test.setTimeout(90_000);
    const pageId = await pageIdBySlug("e2e-ada", "permissions");
    // Throwaway session — this test ends by signing out (see helpers).
    const session = await plantSession("e2e-signout-me", SEEDED_USER_ID.ada);
    const context = await sessionContext(browser, session);
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 780 });

    await page.goto(`/s/eng/${pageId}`);
    await expect(pageTitle(page)).toHaveText("Permissions");

    const tabs = page.getByRole("navigation").last();
    // exact: "Home" contains "me".
    await tabs.getByRole("link", { name: "Me", exact: true }).click();
    await expect(page).toHaveURL(/\/s\/eng\/me$/);
    await expect(page.getByText("Ada Lund")).toBeVisible();
    await expect(page.getByText("ada@acme.io")).toBeVisible();
    await expect(page.getByRole("link", { name: /Permissions/ })).toBeVisible();
    await expect(page.getByText("Star a page from its info rail")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/);

    await context.close();
  });

  test("a user's history is their own", async ({ browser }) => {
    const pageId = await pageIdBySlug("e2e-mira", "onboarding");
    const mira = await sessionContext(browser, "e2e-mira");
    const miraPage = await mira.newPage();
    await miraPage.goto(`/s/eng/${pageId}`);
    await expect(pageTitle(miraPage)).toHaveText("Onboarding");

    const recent = await api<{ id: string }[]>("e2e-mira", "/spaces/1/recent");
    expect(recent.some((r) => r.id === pageId)).toBe(true);

    // Eren never opened it in this test, so it is absent from his list.
    const othersRecent = await api<{ id: string }[]>("e2e-eren", "/spaces/1/recent");
    expect(othersRecent.some((r) => r.id === pageId)).toBe(false);

    await mira.close();
  });
});
