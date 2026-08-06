import { expect, test } from "@playwright/test";
import { api, sessionContext } from "./helpers";

test.describe("authoring: new page + slash commands", () => {
  test("create a page from the sidebar, build blocks with '/', read it back", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const title = `Authored ${Date.now()}`;

    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");

    // New page dialog from the sidebar.
    await page.getByRole("navigation").getByRole("button", { name: "New page" }).click();
    const dialog = page.getByRole("dialog", { name: "New page" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Page title...").fill(title);
    await dialog.getByRole("button", { name: "Create page" }).click();

    // Lands straight in the editor; wait for the realtime session to settle
    // (router.refresh after create can remount the editor once).
    await expect(page).toHaveURL(/\/edit$/, { timeout: 15_000 });
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();

    // Slash menu: filter to the callout block and insert it.
    await page.keyboard.type("/call");
    const menu = page.getByTestId("slash-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Highlight a hard rule")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(menu).not.toBeVisible();
    await page.keyboard.type("Slash-inserted hard rule");
    await expect(editor.locator("aside.callout")).toContainText("Slash-inserted hard rule");

    // A second block type via arrow-key selection: heading 2.
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/heading 2");
    await expect(page.getByTestId("slash-menu")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Slash heading");
    await expect(editor.locator("h2").last()).toContainText("Slash heading");

    // Done → checkpoint; the reader serves the projected blocks.
    await page.waitForTimeout(2500); // store debounce
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/\/edit$/);
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.locator(".article-prose").innerText();
        },
        { timeout: 20_000, intervals: [2_000] },
      )
      .toContain("Slash-inserted hard rule");
    await expect(page.locator(".article-prose aside.callout")).toBeVisible();

    // Cleanup.
    const pages = await api<{ id: string; title: string }[]>("e2e-eren", "/spaces/1/pages");
    const created = pages.find((p) => p.title === title);
    if (created) {
      await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" });
      await api("e2e-eren", `/pages/${created.id}/hard-delete`, { method: "POST" });
    }
    await context.close();
  });
});
