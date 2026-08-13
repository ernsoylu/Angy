import { expect, test } from "@playwright/test";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * @-mentions end to end (V2 H1).
 *
 * The chain is the same one backlinks use — editor → Y.Doc → store → worker
 * projection → block_index — but keyed on a user rather than a page, so it
 * exercises the second `RefKind` and the `target_user_id` index the mention
 * inbox was designed around.
 *
 * Ada (seeded user 4) is the mention target throughout, and Eren does the
 * writing: a spec where the author mentions themselves would pass even if the
 * user id were dropped and the reader's own id substituted.
 */
test.describe("mentions", () => {
  test("mentioning someone reaches their Mentions list", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const title = `Standup ${Date.now().toString(36)}`;

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

    await page.keyboard.type("Ask @Ada");
    const menu = page.getByTestId("mention-menu");
    await expect(menu).toBeVisible({ timeout: 15_000 });
    await menu.getByRole("button", { name: /Ada/ }).first().click();

    // The node lands in the document, not just the text "@Ada".
    const mention = editor.locator("span[data-mention]");
    await expect(mention).toBeVisible({ timeout: 15_000 });
    await expect(mention).toHaveText(/^@/);

    // The reader renders it from the projection, with no editor JS.
    await expect(async () => {
      await page.goto(`/s/eng/${created.id}`);
      await expect(articleBody(page).locator("span[data-mention]")).toHaveCount(1, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 60_000 });

    // ...and it reaches the mentioned user — the point of indexing it. Ada's
    // list, in Ada's session: the row is keyed on who was named, not who wrote.
    const ada = await sessionContext(browser, "e2e-ada");
    const adaPage = await ada.newPage();
    await expect(async () => {
      await adaPage.goto("/s/eng/mentions");
      await expect(adaPage.locator("#main-content")).toContainText(title, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // The author is not mentioned, so it must not appear in *his* list.
    await page.goto("/s/eng/mentions");
    await expect(page.locator("#main-content")).not.toContainText(title);

    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" }).catch(() => {});
    await ada.close();
    await context.close();
  });

  test("the picker searches the directory and escapes cleanly", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Picker ${Date.now().toString(36)}` }),
    });

    await page.goto(`/s/eng/${created.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();

    await page.keyboard.type("@zzzzzznobody");
    // No match is a closed menu, not an empty box claiming to be a menu.
    await expect(page.getByTestId("mention-menu")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.keyboard.type(" plain text");
    await expect(editor.locator("span[data-mention]")).toHaveCount(0);

    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" }).catch(() => {});
    await context.close();
  });
});
