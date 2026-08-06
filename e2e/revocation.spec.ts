import { expect, test } from "@playwright/test";
import { api, pageIdBySlug, sessionContext } from "./helpers";

/**
 * ADR 0008's live revocation, from the editor's side. The realtime server
 * closes the socket with 4403; the client has to read that as a refusal, not
 * as the network blip its default reconnect behaviour would suggest.
 */
test.describe("live revocation", () => {
  test("an editor who loses access sees the restricted state, not 'offline'", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    // Ada is VIEW-only in Engineering; a page grant is what lets her edit, and
    // taking it away is what we are testing.
    const pageId = await pageIdBySlug("e2e-eren", "onboarding");
    await api("e2e-eren", `/pages/${pageId}/permissions`, {
      method: "POST",
      body: JSON.stringify({ email: "ada@acme.io", level: "EDIT" }),
    });

    const context = await sessionContext(browser, "e2e-ada");
    const page = await context.newPage();
    await page.goto(`/s/eng/${pageId}/edit`);
    await expect(page.locator(".tiptap[contenteditable]")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 20_000 });

    // Pull the grant while she is connected.
    const perms = await api<{ grants: { userId: string; email: string }[] }>(
      "e2e-eren",
      `/pages/${pageId}/permissions`,
    );
    const ada = perms.grants.find((g) => g.email === "ada@acme.io")!;
    await api("e2e-eren", `/pages/${pageId}/permissions/${ada.userId}`, { method: "DELETE" });

    await expect(page.getByText("You don't have access to this page")).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator(".tiptap[contenteditable]")).toHaveCount(0);

    await context.close();
  });
});
