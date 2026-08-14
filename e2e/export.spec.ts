import { expect, test } from "@playwright/test";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * Markdown export (ADR 0005, the one-directional *out* flow).
 *
 * Exercised over HTTP rather than as a unit test because the interesting part
 * is not the serializer — that has its own tests — but that the endpoint
 * serves the *projection*, so what you download is what the reader was shown,
 * and that a subtree export refuses to hand over pages the caller cannot read.
 */
const API = "http://localhost:3001";

async function download(session: string, path: string): Promise<{ body: string; cd: string }> {
  const res = await fetch(`${API}${path}`, { headers: { cookie: `angy_session=${session}` } });
  return { body: await res.text(), cd: res.headers.get("content-disposition") ?? "" };
}

test.describe("markdown export", () => {
  test("a page exports as Markdown, as an attachment", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);
    const marker = `Exported line ${stamp}`;

    const created = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Export ${stamp}` }),
    });

    await page.goto(`/s/eng/${created.id}/edit`);
    const editor = page.locator(".tiptap[contenteditable]");
    await expect(editor).toBeVisible();
    await expect(page.getByText("1 live connection")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await editor.click();
    await page.keyboard.type(`## Heading ${stamp}`);
    await page.keyboard.press("Enter");
    await page.keyboard.type(marker);

    // Export reads the projection, so it only has content once that catches up.
    await expect(async () => {
      await page.goto(`/s/eng/${created.id}`);
      await expect(articleBody(page)).toContainText(marker, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    const { body, cd } = await download("e2e-eren", `/pages/${created.id}/export.md`);
    expect(cd).toContain("attachment");
    expect(cd).toMatch(/filename="[a-zA-Z0-9._-]+\.md"/);
    // The title becomes the H1 — it lives on the row, not in the body.
    expect(body).toContain(`# Export ${stamp}`);
    expect(body).toContain(`## Heading ${stamp}`);
    expect(body).toContain(marker);

    await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" }).catch(() => {});
    await context.close();
  });

  test("a subtree export says what it withheld rather than shrinking silently", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await sessionContext(browser, "e2e-eren");
    const stamp = Date.now().toString(36);

    const parent = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Parent ${stamp}` }),
    });
    const child = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Child ${stamp}`, parentId: parent.id }),
    });

    const { body } = await download("e2e-eren", `/pages/${parent.id}/export-subtree.md`);
    expect(body).toContain(`# Parent ${stamp}`);
    expect(body).toContain(`# Child ${stamp}`);
    // Documents are separated, so the boundary between pages survives.
    expect(body).toContain("---");

    // depth=0 is the root alone.
    const shallow = await download("e2e-eren", `/pages/${parent.id}/export-subtree.md?depth=0`);
    expect(shallow.body).toContain(`# Parent ${stamp}`);
    expect(shallow.body).not.toContain(`# Child ${stamp}`);

    for (const id of [child.id, parent.id]) {
      await api("e2e-eren", `/pages/${id}/trash`, { method: "POST" }).catch(() => {});
    }
    await context.close();
  });

  test("export refuses a page the caller cannot read", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-ada");
    // "Roadmap" lives in the private Product space, which Ada is not in.
    const pages = await api<{ id: string; slug: string }[]>("e2e-mira", "/spaces/2/pages");
    const roadmap = pages.find((p) => p.slug === "roadmap")!;

    const res = await fetch(`${API}/pages/${roadmap.id}/export.md`, {
      headers: { cookie: "angy_session=e2e-ada" },
    });
    expect(res.status).toBe(403);
    await context.close();
  });
});
