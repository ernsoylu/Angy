import { expect, test } from "@playwright/test";
import { api, pageIdBySlug, sessionContext } from "./helpers";

test.describe("page move + trash/restore", () => {
  test("move dialog reparents; trash and restore round-trip through the UI", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    // A dedicated page so the seeded tree stays intact for other tests.
    const movableTitle = `Movable ${Date.now()}`;
    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: movableTitle }),
    });

    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto(`/s/eng/${created.id}`);

    // Move under Runbooks via the dialog.
    await page.getByRole("button", { name: "Move page" }).click();
    const dialog = page.getByRole("dialog", { name: "Move page" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Runbooks" }).click();
    await expect(dialog.getByText("destination")).toBeVisible();
    await dialog.getByRole("button", { name: "Move here" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("nav").getByText("Runbooks").first()).toBeVisible();

    // Trash it from the page actions.
    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(page).toHaveURL(/\/s\/eng$/);

    // It shows in the trash with a 30-day countdown; restore brings it back.
    await page.goto("/s/eng/trash");
    // Scoped to the row itself, not `main > div > div`: `hasText` matches
    // ancestors too, so the outer table survived the filter and the Restore
    // button inside it resolved to one per row. That passed only while this
    // spec was the sole thing in the trash — any other spec leaving a page
    // behind broke it, which says nothing about move or restore.
    const row = page.getByTestId("trash-row").filter({ hasText: movableTitle });
    await expect(row.getByText(movableTitle)).toBeVisible();
    await expect(page.getByText(/30 days|29 days/).first()).toBeVisible();
    await row.getByRole("button", { name: "Restore" }).click();
    // Frame C toast confirms the action.
    await expect(page.getByText("Page restored")).toBeVisible();
    // Scope to the listing — the restored page reappears in the sidebar tree.
    await expect(page.locator("main").getByText(movableTitle)).toHaveCount(0);

    // Back in the tree, still under Runbooks.
    const detail = await api<{ breadcrumb: { title: string }[] }>(
      "e2e-eren",
      `/pages/${created.id}`,
    );
    expect(detail.breadcrumb.map((b) => b.title)).toContain("Runbooks");

    // Cleanup: trash + hard delete.
    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" });
    await api("e2e-eren", `/pages/${created.id}/hard-delete`, { method: "POST" });
    await context.close();
  });

  test("both dialogs' search fields narrow, and say so when nothing matches", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const pageId = await pageIdBySlug("e2e-eren", "storage-model");
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();

    // Move dialog (frame 10): filtering keeps the space header that still has
    // a match, and drops the ones that do not.
    await page.goto(`/s/eng/${pageId}`);
    await page.getByRole("button", { name: "Move page" }).click();
    const dialog = page.getByRole("dialog", { name: "Move page" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Search spaces and pages...").fill("runbook");
    await expect(dialog.getByRole("button", { name: /Runbooks/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Onboarding/ })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Product$/ })).toHaveCount(0);

    await dialog.getByPlaceholder("Search spaces and pages...").fill("zzz-nothing");
    await expect(dialog.getByText(/No space or page matches/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Trash (frame 9): the field searches the whole row, not just titles.
    await api("e2e-eren", `/pages/${pageId}/trash`, { method: "POST" });
    await page.goto("/s/eng/trash");
    const search = page.getByPlaceholder("Search trash");
    await expect(page.getByText("Storage Model")).toBeVisible();
    await search.fill("Eren");           // trashed-by, not a title
    await expect(page.getByText("Storage Model")).toBeVisible();
    await search.fill("zzz-nothing");
    await expect(page.getByText(/Nothing in the trash matches/)).toBeVisible();

    await api("e2e-eren", `/pages/${pageId}/restore`, { method: "POST" });
    await context.close();
  });
});
