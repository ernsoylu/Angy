import { expect, test } from "@playwright/test";
import { api, articleBody, pageIdBySlug, sessionContext } from "./helpers";

test.describe("revision history & non-destructive restore (ADR 0006)", () => {
  test("checkpoint → edit → checkpoint → restore produces a forward version", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const pageId = await pageIdBySlug("e2e-eren", "runbooks");
    const before = `history-base-${Date.now()}`;
    const after = `history-extra-${Date.now()}`;

    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();

    // Session 1: type + explicit checkpoint (the Done path).
    await page.goto(`/s/eng/${pageId}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(before);
    await page.waitForTimeout(3000); // store debounce
    await api("e2e-eren", `/pages/${pageId}/revisions`, { method: "POST" });

    // Session 2: another line, another checkpoint.
    await page.keyboard.press("Enter");
    await page.keyboard.type(after);
    await page.waitForTimeout(3000);
    await api("e2e-eren", `/pages/${pageId}/revisions`, { method: "POST" });

    // Wait for both checkpoints to land.
    await expect
      .poll(
        () => api<{ version: number }[]>("e2e-eren", `/pages/${pageId}/revisions`).then((r) => r.length),
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(2);

    // History screen: diff v1 → latest shows the added line. Scope to the
    // rendered document — a bare getByText also matches the inlined RSC flight
    // payload, which carries every string on the page.
    await page.goto(`/s/eng/${pageId}/history?from=1`);
    const main = page.locator("#main-content");
    await expect(main.getByText("Version history")).toBeVisible();
    await expect(main.getByText("non-destructive", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore v1" })).toBeVisible();

    // Restore v1 through the UI.
    await page.getByRole("button", { name: "Restore v1" }).click();
    await expect
      .poll(
        () =>
          api<{ label: string | null }[]>("e2e-eren", `/pages/${pageId}/revisions`).then(
            (revs) => revs.some((r) => r.label?.startsWith("restore of v1")),
          ),
        { timeout: 30_000, intervals: [2_000] },
      )
      .toBe(true);

    // Non-destructive: history kept every version; content reverted.
    const revisions = await api<{ version: number }[]>(
      "e2e-eren",
      `/pages/${pageId}/revisions`,
    );
    expect(revisions.length).toBeGreaterThanOrEqual(3);
    await expect
      .poll(
        async () => {
          await page.goto(`/s/eng/${pageId}`);
          return articleBody(page).innerText();
        },
        { timeout: 20_000, intervals: [2_000] },
      )
      .toContain(before);
    expect(await articleBody(page).innerText()).not.toContain(after);

    await context.close();
  });
});
