import { expect, test } from "@playwright/test";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * Markdown import (ADR 0005, the one-directional *in* flow).
 *
 * The parser has its own unit tests; what only an e2e can show is that an
 * imported page is a *real* page — its document_json becomes a Y.Doc, the
 * worker renders it, and the reader serves it. That chain is the whole claim
 * that import produces pages rather than rows.
 */
interface ImportResult {
  created: { id: string; title: string; path: string }[];
  skipped: { path: string; reason: string }[];
}

test.describe("markdown import", () => {
  test("a bundle becomes a real page tree the reader can serve", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    const result = await api<ImportResult>("e2e-eren", "/spaces/1/import", {
      method: "POST",
      body: JSON.stringify({
        files: [
          {
            path: `handbook-${stamp}/index.md`,
            markdown: `# Handbook ${stamp}\n\nHow we work.\n`,
          },
          {
            path: `handbook-${stamp}/onboarding.md`,
            markdown: [
              `# Onboarding ${stamp}`,
              "",
              "## First week",
              "",
              "- [ ] Read the handbook",
              "- [x] Get a laptop",
              "",
              "```ts",
              "const welcome = true;",
              "```",
            ].join("\n"),
          },
        ],
      }),
    });

    expect(result.skipped).toEqual([]);
    expect(result.created).toHaveLength(2);
    const parent = result.created.find((p) => p.title === `Handbook ${stamp}`)!;
    const child = result.created.find((p) => p.title === `Onboarding ${stamp}`)!;
    expect(parent).toBeDefined();
    expect(child).toBeDefined();

    // The title came from the leading H1, not the filename.
    expect(child.title).toBe(`Onboarding ${stamp}`);

    // The reader serves it, which is only true once the worker turned the
    // imported document_json into a Y.Doc and rendered the projection.
    await expect(async () => {
      await page.goto(`/s/eng/${child.id}`);
      await expect(articleBody(page)).toContainText("First week", { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await expect(articleBody(page)).toContainText("Read the handbook");
    await expect(articleBody(page)).toContainText("const welcome = true;");
    // Checkboxes survived as real task nodes, so the board can see them.
    await expect(articleBody(page).locator('ul[data-type="taskList"] li')).toHaveCount(2);

    // The folder's index file became the parent page, so the tree nests.
    const detail = await api<{ breadcrumb: { title: string }[] }>(
      "e2e-eren",
      `/pages/${child.id}`,
    );
    expect(detail.breadcrumb.map((c) => c.title)).toContain(`Handbook ${stamp}`);

    for (const created of result.created) {
      await api("e2e-eren", `/pages/${created.id}/trash`, { method: "POST" }).catch(() => {});
    }
    await context.close();
  });

  test("a file with no heading is titled from its filename", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const stamp = Date.now().toString(36);

    const result = await api<ImportResult>("e2e-eren", "/spaces/1/import", {
      method: "POST",
      body: JSON.stringify({
        files: [{ path: `release-notes-${stamp}.md`, markdown: "Just a body.\n" }],
      }),
    });

    expect(result.created[0]?.title).toBe(`Release notes ${stamp}`);
    await api("e2e-eren", `/pages/${result.created[0]!.id}/trash`, { method: "POST" }).catch(
      () => {},
    );
    await context.close();
  });

  test("importing needs edit access to the space", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-ada");
    // Ada is not a member of the private Product space.
    const res = await fetch("http://localhost:3001/spaces/2/import", {
      method: "POST",
      headers: { cookie: "angy_session=e2e-ada", "content-type": "application/json" },
      body: JSON.stringify({ files: [{ path: "x.md", markdown: "# X\n" }] }),
    });
    expect(res.status).toBe(403);
    await context.close();
  });
});
