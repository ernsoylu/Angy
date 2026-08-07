import { expect, test } from "@playwright/test";
import { sessionContext } from "./helpers";

/**
 * How a dialog closes — and, more importantly, when it must not.
 *
 * Nothing covered this before. The suite opened dialogs and filled them in, so
 * it proved they worked, but never dismissed one, which left the overlay's
 * click handling entirely untested. That handling was reworked to satisfy an
 * accessibility rule: dismissal now fires only when the click lands on the
 * overlay itself, which let the `stopPropagation` handler on the dialog body
 * come out.
 *
 * The failure that change could introduce is severe and silent — without the
 * target check, every click inside the dialog bubbles to the overlay and
 * closes it, so the dialog shuts the instant you touch a field. The first
 * assertion below is the one that matters.
 */
test.describe("dialog dismissal", () => {
  test("clicking inside does not close; the overlay and Escape do", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");

    const open = async () => {
      await page.getByRole("button", { name: "New space" }).click();
      const dialog = page.getByRole("dialog", { name: "New space" });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    // 1. Interacting with the dialog must not dismiss it. Clicks inside now
    //    reach the overlay by design, so this is the regression guard.
    let dialog = await open();
    await dialog.getByPlaceholder("Engineering").click();
    await dialog.getByPlaceholder("Engineering").fill("Still Open");
    await dialog.getByText("Visibility").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Engineering")).toHaveValue("Still Open");

    // 2. A click on the overlay itself still dismisses. Positioned at the very
    //    top-left of the viewport, which the centred dialog never covers.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();

    // 3. Escape remains the keyboard equivalent — the reason the overlay is
    //    allowed to be presentational at all.
    dialog = await open();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await context.close();
  });
});
