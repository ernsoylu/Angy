import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { api, pageIdBySlug, sessionContext } from "./helpers";

/** Frame D's interaction contract and frame E's mobile tab bar. */
test.describe("shell interaction", () => {
  test("page tree traverses by keyboard: ↑↓ move · → expand · ← collapse · Enter opens", async ({
    browser,
  }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");

    const tree = page.getByRole("tree", { name: "Pages" });
    const onboarding = tree.getByRole("treeitem", { name: "Onboarding" });
    await onboarding.focus();

    // Architecture ships expanded; ← collapses it and hides its children.
    await page.keyboard.press("ArrowDown");
    const architecture = tree.getByRole("treeitem", { name: "Architecture", exact: true });
    await expect(architecture).toBeFocused();
    await expect(architecture).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(architecture).toHaveAttribute("aria-expanded", "false");
    await expect(tree.getByRole("treeitem", { name: "Storage Model" })).toHaveCount(0);

    // → expands again, then steps into the first child.
    await page.keyboard.press("ArrowRight");
    await expect(architecture).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tree.getByRole("treeitem", { name: "Realtime Sync Architecture" })).toBeFocused();

    // ↑ walks back, Enter opens.
    await page.keyboard.press("ArrowUp");
    await expect(architecture).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toHaveText("Architecture");

    await context.close();
  });

  test("compact density is a persisted, desktop-only preference", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");

    // Target the recent list by role, not by the title of a page that happens
    // to be in it. Naming a page made the test depend on how many pages other
    // specs had created: once "Runbooks" fell out of "Recently updated", the
    // locator silently matched a *sidebar* row instead — which has a fixed
    // 31px height and does not answer to density at all. The test then failed
    // for a reason that had nothing to do with the preference it covers.
    const row = page.getByTestId("recent-list").locator("a").first();
    await expect(row).toBeVisible();
    const comfortable = (await row.boundingBox())!.height;

    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Compact density" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    expect((await row.boundingBox())!.height).toBeLessThan(comfortable);

    // Survives a reload…
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");

    // …but never applies at the touch breakpoint (frame D).
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(page.getByTestId("recent-list").locator("a").first()).toHaveCSS(
      "min-height",
      "47px",
    );

    await context.close();
  });

  test("mobile tab bar routes to Home, Search and the current page", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 780 });

    await page.goto("/s/eng");
    const tabs = page.getByRole("navigation").last();
    await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/s/eng");
    // No page open yet, so Page has nowhere to go.
    await expect(tabs.getByRole("link", { name: "Page" })).toHaveAttribute("aria-disabled", "true");

    await tabs.getByRole("link", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/s\/eng\/search$/);

    const pageId = await pageIdBySlug("e2e-eren", "runbooks");
    await page.goto(`/s/eng/${pageId}`);
    await expect(tabs.getByRole("link", { name: "Page" })).toHaveAttribute(
      "href",
      `/s/eng/${pageId}`,
    );

    await context.close();
  });

  test("attachments report every page a content hash is used on", async ({ browser }) => {
    test.setTimeout(90_000);
    const runbooks = await pageIdBySlug("e2e-eren", "runbooks");
    const onboarding = await pageIdBySlug("e2e-eren", "onboarding");
    const bytes = readFileSync("e2e/fixtures/pixel.png");

    // Same blob, two pages — one S3 object, two rows, one usage list.
    for (const pageId of [runbooks, onboarding]) {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "image/png" }), "shared-pixel.png");
      const res = await fetch(`http://localhost:3001/pages/${pageId}/attachments`, {
        method: "POST",
        headers: { cookie: "angy_session=e2e-eren" },
        body: form,
      });
      expect((await res.json()).success).toBe(true);
    }

    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng/attachments");
    await page.getByRole("button", { name: /shared-pixel\.png/ }).first().click();
    await expect(page.getByText("2 pages")).toBeVisible();
    await expect(page.getByRole("link", { name: "Runbooks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Onboarding" })).toBeVisible();

    const attachments = await api<{ id: string; fileName: string }[]>(
      "e2e-eren",
      "/spaces/1/attachments",
    );
    for (const a of attachments.filter((a) => a.fileName === "shared-pixel.png")) {
      await api("e2e-eren", `/attachments/${a.id}`, { method: "DELETE" });
    }
    await context.close();
  });
});
