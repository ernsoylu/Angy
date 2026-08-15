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

  test("space home shows stats and recent pages, with members behind Settings", async ({
    browser,
  }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");
    await expect(page.getByRole("heading", { name: "Engineering" })).toBeVisible();
    await expect(page.getByText("Recently updated")).toBeVisible();

    // Members and the baseline used to sit in a right rail. The rail is gone —
    // the space's own content takes the full width — so the guarantee is that
    // they are one click away, not that they are on the page.
    await expect(page.getByText("Mira Kalvo")).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Space settings" });
    await expect(dialog.getByText("Mira Kalvo")).toBeVisible();
    // Exact: the dialog says "space baseline" twice — once as the caption and
    // once inside "N members · space baseline" — so a substring match is two
    // elements and strict mode fails on the assertion rather than the app.
    await expect(dialog.getByText("Space baseline", { exact: true })).toBeVisible();
    // The way through to the things this dialog deliberately does not do.
    await expect(dialog.getByRole("link", { name: "All settings" })).toBeVisible();

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await context.close();
  });

  test("creating a space is reachable from any screen, not just the space home", async ({
    browser,
  }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    // A page, not the space home: the button moved to the top bar precisely so
    // it stops being tied to one screen.
    await page.goto(`/s/eng/${await pageIdBySlug("e2e-eren", "onboarding")}`);
    await page.getByRole("button", { name: "New space" }).click();
    await expect(page.getByRole("dialog", { name: "New space" })).toBeVisible();
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
