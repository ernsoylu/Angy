import { expect, test } from "@playwright/test";
import { api, sessionContext } from "./helpers";

/**
 * The in-app inbox (V2 H3).
 *
 * The chain under test is worker-side: a mention reaching `block_index` also
 * raises a notification row, and it must do so *once* however many times the
 * projection rebuilds — which it does on every store, every relabel and every
 * reconcile pass.
 */
test.describe("notifications", () => {
  test("being mentioned reaches the bell, once, and only the mentioned user", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);
    const title = `Notify ${stamp}`;

    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title }),
    });

    await page.goto(`/s/eng/${created.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();
    await page.keyboard.type("Ping @Ada");
    const menu = page.getByTestId("mention-menu");
    await expect(menu).toBeVisible({ timeout: 15_000 });
    await menu.getByRole("button", { name: /Ada/ }).first().click();

    // Ada's bell shows it. Eren wrote it, so his must not.
    const ada = await sessionContext(browser, "e2e-ada");
    const adaPage = await ada.newPage();
    await expect(async () => {
      await adaPage.goto("/s/eng");
      await expect(adaPage.getByTestId("bell-badge")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await adaPage.getByRole("button", { name: /Notifications/ }).click();
    const inbox = adaPage.getByRole("dialog", { name: "Notifications" });
    await expect(inbox).toBeVisible();
    await expect(inbox.getByTestId("bell-item").filter({ hasText: title })).toHaveCount(1);

    // Editing again re-runs the projection; the row must not duplicate.
    await editor.click();
    await page.keyboard.type(" and again");
    await page.waitForTimeout(6000);
    await adaPage.reload();
    await adaPage.getByRole("button", { name: /Notifications/ }).click();
    await expect(
      adaPage.getByRole("dialog", { name: "Notifications" })
        .getByTestId("bell-item")
        .filter({ hasText: title }),
    ).toHaveCount(1);

    // Marking read clears the badge and survives a reload.
    await adaPage.getByRole("button", { name: "Mark all read" }).click();
    await expect(adaPage.getByTestId("bell-badge")).toHaveCount(0);
    await adaPage.reload();
    await expect(adaPage.getByTestId("bell-badge")).toHaveCount(0);

    await page.goto("/s/eng");
    await expect(page.getByTestId("bell-badge")).toHaveCount(0);

    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" }).catch(() => {});
    await ada.close();
    await context.close();
  });

  test("an empty inbox says so", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-mira");
    const page = await context.newPage();
    await page.goto("/s/eng");
    await page.getByRole("button", { name: /Notifications/ }).click();
    const inbox = page.getByRole("dialog", { name: "Notifications" });
    await expect(inbox).toBeVisible();
    await expect(inbox).toContainText("Nothing yet");
    await context.close();
  });
});
