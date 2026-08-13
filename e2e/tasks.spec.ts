import { expect, test } from "@playwright/test";
import { api, sessionContext } from "./helpers";

/**
 * The tasks board (V2 H1) — the third and last `RefKind`.
 *
 * This is the consumer that reads a row's *body* rather than what it points
 * at, so it is the one that would have been impossible under the granularity
 * the gate rejected: two to-dos on a page must stay two rows with their own
 * text and done-state.
 */
test.describe("tasks", () => {
  test("a checklist reaches the board, and assignment follows the mention", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);
    const title = `Sprint ${stamp}`;
    const open = `Ship the thing ${stamp}`;
    const assigned = `Review the ADR ${stamp}`;

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

    await page.keyboard.type("/todo");
    await page.getByTestId("slash-menu").waitFor();
    await page.keyboard.press("Enter");
    await expect(editor.locator('ul[data-type="taskList"]')).toBeVisible({ timeout: 15_000 });

    await page.keyboard.type(open);
    await page.keyboard.press("Enter");
    await page.keyboard.type(`${assigned} @Ada`);
    const menu = page.getByTestId("mention-menu");
    await expect(menu).toBeVisible({ timeout: 15_000 });
    await menu.getByRole("button", { name: /Ada/ }).first().click();

    // Tick the first one, so the board has something to exclude.
    await editor.locator('li[data-checked] input[type="checkbox"]').first().check();

    // The board shows what is still open, grouped by the page it came from.
    await expect(async () => {
      await page.goto("/s/eng/tasks");
      await expect(page.getByTestId("task-row").filter({ hasText: assigned })).toHaveCount(1, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 60_000 });

    // The ticked one is gone from the open board — the filter is in SQL, so
    // this also proves the done-state reached the projection.
    await expect(page.getByTestId("task-row").filter({ hasText: open })).toHaveCount(0);
    // ...and the assignee came from the mention inside the task.
    await expect(page.getByTestId("task-row").filter({ hasText: assigned })).toContainText("Ada");

    // Ada sees it under "Assigned to me"; Eren, who wrote it, does not.
    await page.getByRole("button", { name: "Assigned to me" }).click();
    await expect(page.getByTestId("task-row").filter({ hasText: assigned })).toHaveCount(0);

    const ada = await sessionContext(browser, "e2e-ada");
    const adaPage = await ada.newPage();
    await adaPage.goto("/s/eng/tasks");
    await adaPage.getByRole("button", { name: "Assigned to me" }).click();
    await expect(adaPage.getByTestId("task-row").filter({ hasText: assigned })).toHaveCount(1);

    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" }).catch(() => {});
    await ada.close();
    await context.close();
  });

  test("a space with no checklists says so rather than showing an empty frame", async ({
    browser,
  }) => {
    // Mira, because "product" is a PRIVATE space and she is its only member —
    // for anyone else the route 404s before it can render an empty board.
    const context = await sessionContext(browser, "e2e-mira");
    const page = await context.newPage();
    // Seeded with a page but no to-dos.
    await page.goto("/s/product/tasks");
    await expect(page.locator("#main-content")).toContainText("No open tasks");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await context.close();
  });
});
