import { expect, test } from "@playwright/test";
import { api, pageTitle, sessionContext } from "./helpers";

/**
 * Databases-in-pages, first slice (V2 H5.3, ADR 0013). The claim under test is
 * the ADR's central one: **a row is a Page**. So the table is asserted through
 * the reader — server-rendered, no JS — and each row links to a real page.
 */
test.describe("database view", () => {
  test("a page renders its children as a filtered, sorted table", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    const status = await api<{ id: string }>("e2e-eren", "/spaces/1/properties", {
      method: "POST",
      body: JSON.stringify({
        name: `Status ${stamp}`,
        type: "SELECT",
        options: ["Todo", "Doing", "Done"],
      }),
    });
    const estimate = await api<{ id: string }>("e2e-eren", "/spaces/1/properties", {
      method: "POST",
      body: JSON.stringify({ name: `Estimate ${stamp}`, type: "NUMBER", options: [] }),
    });

    const root = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Work ${stamp}` }),
    });

    const rows = [
      { title: `Ship it ${stamp}`, status: "Done", estimate: "3" },
      { title: `Plan it ${stamp}`, status: "Todo", estimate: "8" },
      { title: `Drop it ${stamp}`, status: "Done", estimate: "1" },
    ];
    for (const row of rows) {
      const child = await api<{ id: string }>("e2e-eren", "/pages", {
        method: "POST",
        body: JSON.stringify({ spaceId: "1", parentId: root.id, title: row.title }),
      });
      await api("e2e-eren", `/pages/${child.id}/properties`, {
        method: "PUT",
        body: JSON.stringify({
          values: [
            { propertyId: status.id, value: row.status },
            { propertyId: estimate.id, value: row.estimate },
          ],
        }),
      });
    }

    await api("e2e-eren", `/pages/${root.id}/database`, {
      method: "PUT",
      body: JSON.stringify({
        columns: [status.id, estimate.id],
        filters: [{ propertyId: status.id, op: "equals", value: "Done" }],
        sorts: [{ propertyId: estimate.id, direction: "asc" }],
      }),
    });

    await page.goto(`/s/eng/${root.id}`);
    const table = page.getByTestId("database-view");
    await expect(table).toBeVisible();

    // Filtered to Done, ordered by estimate: "Drop it" (1) then "Ship it" (3).
    const titles = table.locator("tbody th");
    await expect(titles).toHaveText([`Drop it ${stamp}`, `Ship it ${stamp}`]);
    await expect(table.getByText(`Plan it ${stamp}`)).toHaveCount(0);

    // A row is a Page: its title is the way into it.
    await titles.first().getByRole("link").click();
    await expect(pageTitle(page)).toHaveText(`Drop it ${stamp}`);

    // And its cells are edited there, on the row's own page — never in the table.
    await expect(page.getByTestId("page-properties")).toBeVisible();

    // Clean up the vocabulary. A property left behind puts a Properties group
    // on *every* page in the space for every later spec — which is both noise
    // and, because the reader is streamed, a wider window for the
    // duplicate-node race that `pageTitle`/`articleBody` exist to dodge.
    for (const property of [status, estimate]) {
      await api("e2e-eren", `/spaces/1/properties/${property.id}`, { method: "DELETE" });
    }

    await context.close();
  });

  test("a filter the property's type cannot answer is refused", async () => {
    const stamp = Date.now().toString(36);
    const text = await api<{ id: string }>("e2e-eren", "/spaces/1/properties", {
      method: "POST",
      body: JSON.stringify({ name: `Notes ${stamp}`, type: "TEXT", options: [] }),
    });
    const root = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId: "1", title: `Bad filter ${stamp}` }),
    });

    const res = await fetch(`http://localhost:3001/pages/${root.id}/database`, {
      method: "PUT",
      headers: { cookie: "angy_session=e2e-eren", "content-type": "application/json" },
      body: JSON.stringify({
        columns: [text.id],
        filters: [{ propertyId: text.id, op: "gt", value: "5" }],
        sorts: [],
      }),
    });
    // Rejected on save rather than dropped on read: a view that quietly
    // ignores half its filter shows more rows than it was asked for.
    expect(res.status).toBe(400);

    await api("e2e-eren", `/spaces/1/properties/${text.id}`, { method: "DELETE" });
  });
});
