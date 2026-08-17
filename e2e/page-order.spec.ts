import { expect, test } from "@playwright/test";
import { api, sessionContext } from "./helpers";

/**
 * Sibling ordering (V2 H5.1). The keyboard path is what is asserted here, not
 * the drag: native HTML5 drag-and-drop is dispatched differently by every
 * driver, and a suite that runs with `retries: 0` should not carry a test
 * whose failure mode is "the synthetic drag did not take". Both paths call the
 * same `reorder`, so what is under test — the anchor the client sends and the
 * key the server computes — is covered either way.
 */
test.describe("page order", () => {
  test("alt+↑/↓ reorders siblings, and the new order survives a reload", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    const parent = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Order Parent ${stamp}` }),
    });
    const titles = [`Alpha ${stamp}`, `Beta ${stamp}`, `Gamma ${stamp}`];
    for (const title of titles) {
      await api("e2e-eren", "/pages", {
        method: "POST",
        body: JSON.stringify({ spaceId: "1", parentId: parent.id, title }),
      });
    }

    await page.goto(`/s/eng/${parent.id}`);
    const tree = page.getByRole("tree", { name: "Pages" });

    // Creation order is the starting order.
    const children = () =>
      tree.getByRole("treeitem").filter({ hasText: stamp }).filter({ hasNotText: "Order Parent" });
    await expect(children()).toHaveText(titles);

    // Gamma moves up one place: alt+↑ from the last child.
    await tree.getByRole("treeitem", { name: titles[2] }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(children()).toHaveText([titles[0], titles[2], titles[1]]);

    // It is the server's order now, not a local shuffle.
    await page.reload();
    await expect(children()).toHaveText([titles[0], titles[2], titles[1]]);

    // And alt+↑ again puts it first, where there is no anchor to follow.
    await tree.getByRole("treeitem", { name: titles[2] }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(children()).toHaveText([titles[2], titles[0], titles[1]]);
    await page.reload();
    await expect(children()).toHaveText([titles[2], titles[0], titles[1]]);

    await context.close();
  });

  test("a reorder moves one page and leaves the rest of the tree alone", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    const parent = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Untouched Parent ${stamp}` }),
    });
    await api("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", parentId: parent.id, title: `Stays ${stamp}` }),
    });
    const second = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", parentId: parent.id, title: `Moves ${stamp}` }),
    });

    await api("e2e-eren", `/pages/${second.id}/order`, {
      method: "POST",
      body: JSON.stringify({ afterId: null }),
    });

    await page.goto(`/s/eng/${parent.id}`);
    const tree = page.getByRole("tree", { name: "Pages" });
    await expect(
      tree.getByRole("treeitem").filter({ hasText: stamp }).filter({ hasNotText: "Parent" }),
    ).toHaveText([`Moves ${stamp}`, `Stays ${stamp}`]);

    // The anchor must be a sibling — an unrelated page is refused rather than
    // silently reparenting anything.
    const res = await fetch(`http://localhost:3001/pages/${second.id}/order`, {
      method: "POST",
      headers: { cookie: "angy_session=e2e-eren", "content-type": "application/json" },
      body: JSON.stringify({ afterId: parent.id }),
    });
    expect(res.status).toBe(400);

    await context.close();
  });
});
