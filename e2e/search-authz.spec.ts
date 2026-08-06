import { expect, test } from "@playwright/test";
import { sessionContext } from "./helpers";

test.describe("search authz (ADR 0009)", () => {
  test("results are scoped to what the user can read", async ({ browser }) => {
    // Eren is not a Product member — the private Roadmap page must not leak.
    const erenContext = await sessionContext(browser, "e2e-eren");
    const eren = await erenContext.newPage();
    await eren.goto("/s/eng/search?q=Private+space+content");
    await expect(eren.getByText("scoped to what you can read")).toBeVisible();
    await expect(eren.getByText("Roadmap")).toHaveCount(0);
    await erenContext.close();

    // Mira is a Product admin — same query finds it.
    const miraContext = await sessionContext(browser, "e2e-mira");
    const mira = await miraContext.newPage();
    await mira.goto("/s/eng/search?q=Private+space+content");
    await expect(mira.getByRole("link", { name: /Roadmap/ }).first()).toBeVisible();
    await miraContext.close();
  });

  test("search is typo-tolerant and highlights matches", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng/search?q=persistance+contrct");
    await expect(
      page.getByRole("link", { name: /Realtime Sync Architecture/ }).first(),
    ).toBeVisible();
    await expect(page.locator("mark").first()).toBeVisible();
    await context.close();
  });

  test("the top bar search field drives the search page", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");
    await page.getByPlaceholder("Search Engineering...").fill("hocuspocus");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/s\/eng\/search\?q=hocuspocus/);
    await expect(page.getByText("scoped to what you can read")).toBeVisible();
    await context.close();
  });
});
