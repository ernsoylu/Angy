import { expect, test } from "@playwright/test";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * Comments (V2 H5.2, ADR 0014). The anchor is a mark in the Y.Doc; the thread
 * is relational. What is worth asserting end to end is exactly the seam
 * between those two: a thread opened through the editor must come back as a
 * *painted* anchor on the SSR reader, and resolving it must stop the paint
 * without touching the document.
 */
test.describe("comments", () => {
  test("a comment opened in the editor paints its anchor on the reader", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Commented ${stamp}` }),
    });

    await page.goto(`/s/eng/${created.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();
    await page.keyboard.type("The claim under review.");

    // Select the sentence and comment on it through the bubble toolbar.
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.getByRole("button", { name: "Comment" }).click();
    await page.getByLabel("Comment", { exact: true }).fill(`Is this right? ${stamp}`);
    await page.keyboard.press("Enter");

    // The rail is the editor's own copy of the thread list.
    await expect(page.getByTestId("comments").getByText(`Is this right? ${stamp}`)).toBeVisible();

    // Checkpoint so the projection rebuilds from the stored document.
    await page.getByRole("button", { name: "Done" }).click();
    await expect(articleBody(page)).toContainText("The claim under review.");

    // The anchor survived the round trip through the Y.Doc and the static
    // renderer, and the reader is painting it because the thread is open.
    const anchor = articleBody(page).locator("mark[data-thread-id]");
    await expect(anchor).toHaveCount(1);
    await expect(anchor).toHaveCSS("border-bottom-width", "1px");

    // Resolving is not an edit: the mark stays, the paint stops.
    await page.getByRole("button", { name: "Resolve" }).first().click();
    await expect(page.getByText(/Show 1 resolved/)).toBeVisible();
    await page.reload();
    await expect(articleBody(page).locator("mark[data-thread-id]")).toHaveCount(1);
    await expect(articleBody(page).locator("mark[data-thread-id]")).toHaveCSS(
      "border-bottom-width",
      "0px",
    );

    await context.close();
  });

  test("a reply reaches the other participant's inbox, once", async () => {
    const stamp = Date.now().toString(36);
    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Inbox comment ${stamp}` }),
    });
    const thread = await api<{ id: string }>("e2e-eren", `/pages/${created.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ anchorText: "a phrase", body: `Opening remark ${stamp}` }),
    });

    // Mira replies; Eren opened the thread, so Eren is the audience.
    await api("e2e-mira", `/comments/${thread.id}/replies`, {
      method: "POST",
      body: JSON.stringify({ body: `A reply ${stamp}` }),
    });
    await api("e2e-mira", `/comments/${thread.id}/replies`, {
      method: "POST",
      body: JSON.stringify({ body: `And another ${stamp}` }),
    });

    const inbox = await api<{ kind: string; pageId: string }[]>("e2e-eren", "/notifications");
    const mine = inbox.filter((row) => row.pageId === created.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("COMMENT");
  });

  test("a thread is exactly as readable as the page it hangs off", async () => {
    const stamp = Date.now().toString(36);
    // Space 2 is the private Product space; Eren is not a member of it.
    const pages = await api<{ id: string; title: string }[]>("e2e-mira", "/spaces/2/pages");
    const target = pages[0];
    const thread = await api<{ id: string }>("e2e-mira", `/pages/${target.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ anchorText: "private text", body: `Private remark ${stamp}` }),
    });

    const res = await fetch(`http://localhost:3001/pages/${target.id}/comments`, {
      headers: { cookie: "angy_session=e2e-eren" },
    });
    expect(res.status).toBe(403);

    const reply = await fetch(`http://localhost:3001/comments/${thread.id}/replies`, {
      method: "POST",
      headers: { cookie: "angy_session=e2e-eren", "content-type": "application/json" },
      body: JSON.stringify({ body: "let me in" }),
    });
    expect(reply.status).toBe(403);
  });
});
