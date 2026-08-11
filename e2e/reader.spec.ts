import { expect, test } from "@playwright/test";
import { articleBody, pageIdBySlug, sessionContext } from "./helpers";

test.describe("reader SSR + edit-on-click", () => {
  test("streams worker-rendered HTML with zero editor JS, then mounts the editor behind Edit", async ({
    browser,
  }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const pageId = await pageIdBySlug("e2e-eren", "realtime-sync");

    await page.goto(`/s/eng/${pageId}`);
    await expect(page.getByRole("heading", { name: "Realtime Sync Architecture" })).toBeVisible();
    // Projection content: callout, code block, and table all render server-side.
    await expect(page.locator(".callout-hardRule")).toBeVisible();
    await expect(articleBody(page).locator("pre")).toBeVisible();
    await expect(articleBody(page).locator("table")).toBeVisible();
    // The read path ships no editor: no ProseMirror mount anywhere.
    await expect(page.locator(".tiptap")).toHaveCount(0);
    // TOC built from injected heading ids.
    await expect(page.locator('a[href="#the-ydoc-lifecycle"]')).toBeVisible();

    // Edit-on-click: the editor exists only behind the explicit Edit action.
    // exact: the byline's "Edit tags" button also matches a loose "Edit".
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/s/eng/${pageId}/edit$`));
    await expect(page.locator(".tiptap[contenteditable]")).toBeVisible();
    await expect(page.getByText("Live editing", { exact: false })).toBeVisible();

    await context.close();
  });

  test("space home shows stats, recent pages, and members", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");
    await expect(page.getByRole("heading", { name: "Engineering" })).toBeVisible();
    await expect(page.getByText("Recently updated")).toBeVisible();
    await expect(page.getByText("Mira Kalvo")).toBeVisible();
    await expect(page.getByText("Space baseline", { exact: false })).toBeVisible();
    await context.close();
  });

  test("unknown pages render the styled not-found state", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("This page doesn't exist")).toBeVisible();
    await context.close();
  });

  test("a view-only user cannot open the editor", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-ada");
    const page = await context.newPage();
    const pageId = await pageIdBySlug("e2e-ada", "storage-model");
    await page.goto(`/s/eng/${pageId}/edit`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await context.close();
  });
});
