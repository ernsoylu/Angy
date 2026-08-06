import { expect, test } from "@playwright/test";
import { api, pageIdBySlug, sessionContext } from "./helpers";

test.describe("session: rename + sign out", () => {
  test("renaming in the editor updates the tree and reader", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const pageId = await pageIdBySlug("e2e-eren", "decisions");
    const newTitle = `Decisions ${Date.now()}`;

    await page.goto(`/s/eng/${pageId}/edit`);
    const title = page.getByRole("textbox", { name: "Page title" });
    await expect(title).toBeVisible();
    await title.fill(newTitle);
    await title.press("Enter");
    await expect
      .poll(
        () => api<{ title: string }>("e2e-eren", `/pages/${pageId}`).then((p) => p.title),
        { timeout: 15_000 },
      )
      .toBe(newTitle);

    // A fresh navigation shows the rename in both the reader and the tree.
    await page.goto(`/s/eng/${pageId}`);
    await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
    await expect(page.locator("nav").getByText(newTitle).first()).toBeVisible();

    // Restore the seeded title so other tests stay deterministic.
    await api("e2e-eren", `/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Decisions (ADR)" }),
    });
    await context.close();
  });

  test("the account menu signs the user out", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-ada");
    const page = await context.newPage();
    await page.goto("/s/eng");
    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByText("ada@acme.io")).toBeVisible();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/, { timeout: 15_000 });

    // The session is really gone: protected pages bounce to sign-in.
    await page.goto("/s/eng");
    await expect(page).toHaveURL(/\/signin$/);
    await context.close();
  });
});
