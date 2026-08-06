import { expect, test } from "@playwright/test";
import { api, sessionContext } from "./helpers";

/** Frame 2's editor chrome beyond the slash menu: link, tables, block gutter. */
test.describe("editor affordances", () => {
  test("bubble-menu link, table controls, and the `+` block inserter", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Affordances ${Date.now()}` }),
    });

    await page.goto(`/s/eng/${created.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();

    // Each step below starts from an empty document rather than chaining onto
    // the previous one's caret — a stray Enter between React renders would
    // otherwise leave "/" mid-paragraph, where the suggestion never triggers.

    // Table: the structure toolbar appears only with the caret inside a table.
    await page.keyboard.type("/table");
    await page.getByTestId("slash-menu").waitFor();
    await page.keyboard.press("Enter");
    const tableToolbar = page.getByTestId("table-toolbar");
    await expect(tableToolbar).toBeVisible();
    await expect(editor.locator("table tr")).toHaveCount(3);
    await tableToolbar.getByRole("button", { name: "Row below" }).click();
    await expect(editor.locator("table tr")).toHaveCount(4);
    await expect(editor.locator("table tr").first().locator("th")).toHaveCount(2);
    await tableToolbar.getByRole("button", { name: "Column right" }).click();
    await expect(editor.locator("table tr").first().locator("th")).toHaveCount(3);
    await tableToolbar.getByRole("button", { name: "Delete row" }).click();
    await expect(editor.locator("table tr")).toHaveCount(3);
    await tableToolbar.getByRole("button", { name: "Delete table" }).click();
    await expect(editor.locator("table")).toHaveCount(0);
    await expect(tableToolbar).toBeHidden();

    // Link: select the word, apply a URL through the bubble toolbar.
    await editor.click();
    await page.keyboard.type("angy");
    await page.keyboard.press("ControlOrMeta+A");
    await page.getByRole("button", { name: "Link", exact: true }).click();
    const url = page.getByLabel("Link URL");
    await expect(url).toBeVisible();
    await url.fill("https://example.com/handbook");
    await url.press("Enter");
    await expect(editor.locator("a[href='https://example.com/handbook']")).toHaveText("angy");
    // The mark applies synchronously but the field unmounts on the next render.
    await expect(url).toBeHidden();

    // Block gutter: hovering a block reveals `⠿` and `+`; `+` opens the palette.
    const firstBlock = editor.locator("p").first();
    await firstBlock.hover();
    await expect(page.getByTestId("drag-handle")).toBeVisible();
    await page.getByRole("button", { name: "Insert block below" }).click();
    await expect(page.getByTestId("slash-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" });
    await api("e2e-eren", `/pages/${created.id}/hard-delete`, { method: "POST" });
    await context.close();
  });
});
