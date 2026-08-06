import { expect, test } from "@playwright/test";
import { pageIdBySlug, sessionContext } from "./helpers";

test.describe("multi-user collaboration", () => {
  test("two editors see each other's edits and presence live", async ({ browser }) => {
    const pageId = await pageIdBySlug("e2e-eren", "realtime-sync");
    const marker = `collab-e2e-${Date.now()}`;

    const erenContext = await sessionContext(browser, "e2e-eren");
    const miraContext = await sessionContext(browser, "e2e-mira");
    const eren = await erenContext.newPage();
    const mira = await miraContext.newPage();

    await eren.goto(`/s/eng/${pageId}/edit`);
    await mira.goto(`/s/eng/${pageId}/edit`);
    await expect(eren.locator(".tiptap[contenteditable]")).toBeVisible();
    await expect(mira.locator(".tiptap[contenteditable]")).toBeVisible();

    // Presence: both rails list both users.
    await expect(eren.getByText("Mira Kalvo")).toBeVisible();
    await expect(mira.getByText("Eren Soylu")).toBeVisible();
    await expect(mira.getByText("2 live connections")).toBeVisible();

    // Eren types at the end of the doc; Mira sees it without reloading.
    await eren.locator(".tiptap[contenteditable]").click();
    await eren.keyboard.press("ControlOrMeta+End");
    await eren.keyboard.press("Enter");
    await eren.keyboard.type(`Typed by Eren: ${marker}`);
    await expect(mira.locator(".tiptap[contenteditable]")).toContainText(marker, {
      timeout: 10_000,
    });

    await erenContext.close();
    await miraContext.close();

    // Live-by-default: the SSR reader catches up after debounce + projection.
    const readerContext = await sessionContext(browser, "e2e-ada");
    const reader = await readerContext.newPage();
    await expect
      .poll(
        async () => {
          await reader.goto(`/s/eng/${pageId}`);
          return reader.locator(".article-prose").innerText();
        },
        { timeout: 20_000, intervals: [2_000] },
      )
      .toContain(marker);
    await readerContext.close();
  });
});
