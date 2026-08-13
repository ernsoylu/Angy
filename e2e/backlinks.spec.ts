import { expect, test } from "@playwright/test";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * `block_index` end to end (V2 H1).
 *
 * The unit and integration tests cover the extractor and the SQL; what only an
 * e2e can prove is that the whole pipeline is actually connected — editor →
 * Y.Doc → store debounce → worker projection → block_index → the reader's rail,
 * across four processes. Both assertions here failed against a stack where any
 * one link in that chain was missing.
 *
 * Timings are polled rather than slept on: projections are asynchronous by
 * design (ADR 0010, live-by-default), so the only honest assertion is
 * "converges within a bound", not "is true on the next paint".
 */
test.describe("backlinks", () => {
  test("a link makes the target list its source, and a rename relabels it", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);
    const targetTitle = `Backlink Target ${stamp}`;
    const sourceTitle = `Backlink Source ${stamp}`;

    const target = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: targetTitle }),
    });
    const source = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: sourceTitle }),
    });

    // Author the link through the editor — the point is that the reference
    // reaches block_index from a real Y.Doc, not from a fixture.
    await page.goto(`/s/eng/${source.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();

    await page.keyboard.type("/page");
    await page.getByTestId("slash-menu").waitFor();
    await page.keyboard.press("Enter");

    const picker = page.getByRole("dialog", { name: "Link a page" });
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await picker.getByPlaceholder(/Search pages/).fill(targetTitle);
    await picker.getByRole("button", { name: targetTitle }).click();
    await expect(editor.locator("a[data-page-link]")).toHaveText(targetTitle, {
      timeout: 15_000,
    });

    // The target now knows who points at it — the query the index exists for.
    await expect(async () => {
      await page.goto(`/s/eng/${target.id}`);
      await expect(page.getByTestId("backlinks")).toContainText(sourceTitle, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // Renaming the target must reach the *reader* of the page linking to it.
    // In V1 this label was frozen at authoring time; the backlink index is what
    // makes the referring projection rebuildable.
    const renamed = `${targetTitle} Renamed`;
    await api("e2e-eren", `/pages/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: renamed }),
    });

    await expect(async () => {
      await page.goto(`/s/eng/${source.id}`);
      await expect(articleBody(page).locator("a[data-page-link]")).toHaveText(renamed, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 60_000 });

    // ...and the *editor* too, which renders from the Y.Doc and so cannot be
    // fixed by the projection. Reopening it is the load-time repair path: the
    // node itself is rewritten, which is what every link authored before a
    // rename needs — including every one V1 left behind.
    await page.goto(`/s/eng/${source.id}/edit`);
    await expect(page.locator(".tiptap[contenteditable] a[data-page-link]")).toHaveText(renamed, {
      timeout: 20_000,
    });

    // `eng` is shared and its "Recently updated" list is a fixed length, so
    // every page left behind pushes an older one out of a list another spec
    // asserts against.
    for (const id of [source.id, target.id]) {
      await api("e2e-eren", `/pages/${id}/trash`, { method: "POST" }).catch(() => {});
    }
    await context.close();
  });

  test("a page nothing links to shows no backlinks rail", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const lonely = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Lonely ${Date.now().toString(36)}` }),
    });

    await page.goto(`/s/eng/${lonely.id}`);
    await expect(page.locator("#main-content")).toBeVisible();
    // Absent, not an empty group: a rail heading with nothing under it reads as
    // a loading state.
    await expect(page.getByTestId("backlinks")).toHaveCount(0);

    await api("e2e-eren", `/pages/${lonely.id}/trash`, { method: "POST" }).catch(() => {});
    await context.close();
  });
});
