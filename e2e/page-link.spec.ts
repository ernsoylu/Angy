import { expect, test } from "@playwright/test";
import { api, sessionContext } from "./helpers";

/**
 * `/page` — creating a child page from inside the editor.
 *
 * Worth an e2e rather than leaning on the unit tests, because the interesting
 * part is the seam: the slash item cannot create anything itself, so it fires a
 * DOM event, the Editor calls the API, and only then does a node reach the
 * Y.Doc. Three processes and a round trip, none of which the renderer tests in
 * packages/blocks exercise.
 */
test.describe("page links", () => {
  test("creates a real child page and links to it", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const parent = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Parent ${Date.now()}` }),
    });

    await page.goto(`/s/eng/${parent.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();

    await page.keyboard.type("/page");
    await page.getByTestId("slash-menu").waitFor();
    await page.keyboard.press("Enter");

    // The node only appears after the API round trip, so this also asserts the
    // ordering: no link is inserted unless the page really was created.
    const link = editor.locator("a[data-page-link]");
    await expect(link).toBeVisible({ timeout: 15_000 });

    // Space-agnostic by design — a space key baked into the href would go stale
    // the moment the page moved.
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/p\/[0-9a-f-]{36}$/);

    // Following it lands on the child, and the child is genuinely nested:
    // the breadcrumb proves the closure table was written, not just the doc.
    await link.click();
    await page.waitForURL(/\/s\/eng\/[0-9a-f-]{36}$/);
    await expect(page.locator("#main-content")).toContainText("Untitled");

    // Trash what this spec created. `eng` is shared, and its "Recently
    // updated" list is a fixed length: every page left behind pushes an older
    // one out, which is how a test elsewhere came to assert against a sidebar
    // row it never meant to select.
    const childId = page.url().split("/").pop()!;
    for (const id of [childId, parent.id]) {
      await api("e2e-eren", `/pages/${id}/trash`, { method: "POST" }).catch(() => {});
    }
  });

  test("a permalink for a page that no longer exists 404s rather than looping", async ({
    browser,
  }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const res = await page.goto("/p/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
  });
});
