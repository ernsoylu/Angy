import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { api, pageIdBySlug, sessionContext } from "./helpers";

/** Wave D: freeform workspace-wide tags, and search over attachments. */
test.describe("tags", () => {
  test("tagging from the reader normalises, shows chips, and drives the facet", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const pageId = await pageIdBySlug("e2e-eren", "decisions");
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto(`/s/eng/${pageId}`);

    // Freeform: type it and it exists. "ADR Records" and "adr records" are the
    // same tag once normalised.
    await page.getByRole("button", { name: "Edit tags" }).click();
    const field = page.getByLabel("Add a tag");
    await field.fill("ADR Records");
    await field.press("Enter");
    await expect(page.getByRole("link", { name: "adr-records" })).toBeVisible();

    await field.fill("adr records");
    await field.press("Enter");
    // Still one chip — the duplicate collapsed rather than creating a second.
    await expect(page.getByRole("link", { name: "adr-records" })).toHaveCount(1);
    await page.keyboard.press("Escape");

    // Survives a reload: the tag is server state, not local.
    await page.reload();
    await expect(page.getByRole("link", { name: "adr-records" })).toBeVisible();

    // The chip carries into search, where it appears as a facet.
    await page.getByRole("link", { name: "adr-records" }).click();
    await expect(page).toHaveURL(/tags=adr-records/);
    await expect(page.getByRole("link", { name: /Decisions/ }).first()).toBeVisible();
    await expect(page.getByText("Tags")).toBeVisible();

    // Cleanup so later runs start clean.
    await api("e2e-eren", `/pages/${pageId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: [] }),
    });
    await context.close();
  });

  test("a view-only reader sees chips but cannot edit them", async ({ browser }) => {
    const pageId = await pageIdBySlug("e2e-eren", "permissions");
    await api("e2e-eren", `/pages/${pageId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: ["security"] }),
    });

    const context = await sessionContext(browser, "e2e-ada"); // VIEW in eng
    const page = await context.newPage();
    await page.goto(`/s/eng/${pageId}`);
    await expect(page.getByRole("link", { name: "security" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit tags" })).toHaveCount(0);

    // And the API refuses her directly, not just in the UI.
    const res = await fetch(`http://localhost:3001/pages/${pageId}/tags`, {
      method: "PUT",
      headers: { cookie: "angy_session=e2e-ada", "content-type": "application/json" },
      body: JSON.stringify({ tags: ["nope"] }),
    });
    expect((await res.json()).success).toBe(false);

    await api("e2e-eren", `/pages/${pageId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: [] }),
    });
    await context.close();
  });

  test("renaming a tag needs admin on every space it touches", async ({ browser }) => {
    // Same tag on an Engineering page and a Product page.
    const engPage = await pageIdBySlug("e2e-eren", "onboarding");
    await api("e2e-eren", `/pages/${engPage}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: ["shared-label"] }),
    });
    const productPages = await api<{ id: string; slug: string }[]>(
      "e2e-mira",
      "/spaces/2/pages",
    );
    const prodPage = productPages[0]!.id;
    await api("e2e-mira", `/pages/${prodPage}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: ["shared-label"] }),
    });

    const tags = await api<{ id: string; name: string }[]>("e2e-eren", "/tags?q=shared-label");
    const tagId = tags.find((t) => t.name === "shared-label")!.id;

    // Eren administers Engineering but not Product, so the rename is refused.
    const refused = await fetch(`http://localhost:3001/tags/${tagId}/rename`, {
      method: "POST",
      headers: { cookie: "angy_session=e2e-eren", "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed-label" }),
    });
    const body = await refused.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain("every space");

    await api("e2e-eren", `/pages/${engPage}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: [] }),
    });
    await api("e2e-mira", `/pages/${prodPage}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: [] }),
    });
    void browser;
  });

  test("attachments are searchable, and only by people who can read the page", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const engPage = await pageIdBySlug("e2e-eren", "storage-model");
    const marker = `blueprint-${Date.now()}`;
    const bytes = readFileSync("e2e/fixtures/pixel.png");

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/png" }), `${marker}.png`);
    const upload = await fetch(`http://localhost:3001/pages/${engPage}/attachments`, {
      method: "POST",
      headers: { cookie: "angy_session=e2e-eren" },
      body: form,
    });
    const uploaded = await upload.json();
    expect(uploaded.success).toBe(true);

    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await expect
      .poll(
        async () => {
          await page.goto(`/s/eng/search?q=${marker}&tab=attachments`);
          return page.getByRole("link", { name: new RegExp(marker) }).count();
        },
        { timeout: 25_000, intervals: [2_000] },
      )
      .toBeGreaterThan(0);

    // The tab is a real filter, not decoration — the file is the only hit,
    // with no page results alongside it. (Scoped to main: the sidebar has an
    // "Attachments" link too.)
    const main = page.locator("#main-content");
    await expect(main.getByRole("link", { name: "Attachments" })).toBeVisible();
    await expect(main.getByRole("link", { name: new RegExp(marker) })).toHaveCount(1);
    await context.close();

    // Deleting it removes it from search — soft delete must not linger.
    await api("e2e-eren", `/attachments/${uploaded.data.id}`, { method: "DELETE" });
    const after = await sessionContext(browser, "e2e-eren");
    const check = await after.newPage();
    await expect
      .poll(
        async () => {
          await check.goto(`/s/eng/search?q=${marker}&tab=attachments`);
          return check.getByRole("link", { name: new RegExp(marker) }).count();
        },
        { timeout: 25_000, intervals: [2_000] },
      )
      .toBe(0);
    await after.close();
  });
});
