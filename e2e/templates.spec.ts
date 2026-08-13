import { expect, test } from "@playwright/test";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * Page templates (V2 H2).
 *
 * The round trip is the whole feature: a page's body is snapshotted, and a new
 * page created from it comes up with that body already in its Y.Doc. That last
 * part is what an API test could not prove — the template seeds
 * `document_json`, and only the worker turning it into a Y.Doc makes it
 * something the reader and the editor actually show.
 */
test.describe("page templates", () => {
  test("a page becomes a template, and a new page starts from it", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);
    const marker = `Retro agenda ${stamp}`;

    const source = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Retro ${stamp}` }),
    });

    // Give the template something recognisable to carry.
    await page.goto(`/s/eng/${source.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();
    await page.keyboard.type(marker);

    // The projection has to catch up before there is anything to snapshot —
    // the API refuses rather than saving an empty template.
    await expect(async () => {
      await page.goto(`/s/eng/${source.id}`);
      await expect(articleBody(page)).toContainText(marker, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await page.getByRole("button", { name: "Save as template" }).click();
    const dialog = page.getByRole("dialog", { name: "Save as template" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("template-name").fill(`Retro template ${stamp}`);
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toContainText("New page dialog");
    await dialog.getByRole("button", { name: "Done" }).click();

    // Creating from it lands in the editor with the template's body already
    // there — proof the seeded document_json became a real Y.Doc.
    await page.getByRole("button", { name: "New page" }).first().click();
    const newPage = page.getByRole("dialog", { name: "New page" });
    await expect(newPage).toBeVisible();
    await newPage.getByPlaceholder("Page title...").fill(`From template ${stamp}`);
    await newPage.getByRole("combobox").last().selectOption({ label: `Retro template ${stamp}` });
    await newPage.getByRole("button", { name: "Create page" }).click();

    await expect(page.locator(".tiptap[contenteditable]")).toContainText(marker, {
      timeout: 30_000,
    });

    const createdId = page.url().match(/([0-9a-f-]{36})/)?.[1];
    for (const id of [createdId, source.id]) {
      if (id) await api("e2e-eren", `/pages/${id}/trash`, { method: "POST" }).catch(() => {});
    }
    await context.close();
  });

  test("a blank page is still blank when templates exist", async ({ browser }) => {
    // The picker defaults to "Blank page"; a template must be opt-in, or every
    // new page in a space silently inherits someone else's structure.
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    await page.goto("/s/eng");
    await page.getByRole("button", { name: "New page" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New page" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Page title...").fill(`Blank ${stamp}`);
    await dialog.getByRole("button", { name: "Create page" }).click();

    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).not.toContainText("Retro agenda");

    const createdId = page.url().match(/([0-9a-f-]{36})/)?.[1];
    if (createdId) {
      await api("e2e-eren", `/pages/${createdId}/trash`, { method: "POST" }).catch(() => {});
    }
    await context.close();
  });
});
