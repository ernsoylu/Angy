import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ORDER_KEY_START } from "@angy/shared";
import { createPage } from "../src/closure.js";
import { getDatabaseView, queryDatabaseRows } from "../src/database.js";
import { TEST_URL } from "./global-setup.js";

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let spaceId: bigint;
let userId: bigint;
let root: string;
let status: bigint;
let estimate: bigint;
let due: bigint;
let done: bigint;

const titles = (rows: { title: string }[]) => rows.map((row) => row.title);

async function makeRow(title: string, values: Record<string, string | number | Date | boolean>) {
  const page = await createPage(prisma, {
    spaceId,
    parentId: root,
    title,
    slug: `${title.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
    createdBy: userId,
  });
  for (const [propertyId, value] of Object.entries(values)) {
    await prisma.pagePropertyValue.create({
      data: {
        pageId: page.id,
        propertyId: BigInt(propertyId),
        updatedBy: userId,
        ...(typeof value === "string"
          ? { textValue: value }
          : typeof value === "number"
            ? { numberValue: value }
            : typeof value === "boolean"
              ? { checkboxValue: value }
              : { dateValue: value }),
      },
    });
  }
  return page;
}

beforeAll(async () => {
  const user = await prisma.appUser.create({
    data: { oidcSubject: "test|db", email: "db@test.io", displayName: "DB Tester" },
  });
  userId = user.id;
  spaceId = (await prisma.space.create({ data: { key: "db-test", name: "Database Test" } })).id;

  const property = async (name: string, type: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT") =>
    (
      await prisma.pageProperty.create({
        data: {
          spaceId,
          name,
          type,
          options: type === "SELECT" ? ["Todo", "Doing", "Done"] : [],
          ord: ORDER_KEY_START,
          createdBy: userId,
        },
      })
    ).id;

  status = await property("Status", "SELECT");
  estimate = await property("Estimate", "NUMBER");
  due = await property("Due", "DATE");
  done = await property("Shipped", "CHECKBOX");

  root = (
    await createPage(prisma, {
      spaceId,
      title: "The database",
      slug: "the-database",
      createdBy: userId,
    })
  ).id;

  await makeRow("Charlie", {
    [status.toString()]: "Done",
    [estimate.toString()]: 3,
    [due.toString()]: new Date("2026-03-01"),
    [done.toString()]: true,
  });
  await makeRow("Alpha", {
    [status.toString()]: "Todo",
    [estimate.toString()]: 8,
    [due.toString()]: new Date("2026-01-01"),
  });
  await makeRow("Bravo", { [status.toString()]: "Doing", [estimate.toString()]: 5 });
  await makeRow("Delta", {});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("queryDatabaseRows", () => {
  const query = (filters: never[] | object[] = [], sorts: object[] = []) =>
    queryDatabaseRows(prisma, root, {
      userId,
      filters: filters as never,
      sorts: sorts as never,
      limit: 100,
    });

  it("returns the page's children in sibling order when nothing is configured", async () => {
    const { rows, total } = await query();
    expect(titles(rows)).toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);
    expect(total).toBe(4);
  });

  it("filters on an exact value, in SQL", async () => {
    const { rows, total } = await query([
      { propertyId: status.toString(), op: "equals", value: "Done" },
    ]);
    expect(titles(rows)).toEqual(["Charlie"]);
    // `total` counts what matched, not what was fetched.
    expect(total).toBe(1);
  });

  it("filters case-insensitively on a substring", async () => {
    // "Todo", "Doing" and "Done" all contain it — case-insensitively is the
    // point, and the lower-cased "do" of "Todo" is the case that proves it.
    const { rows } = await query([
      { propertyId: status.toString(), op: "contains", value: "do" },
    ]);
    expect(titles(rows).sort()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("compares numbers as numbers, not as text", async () => {
    // The trap a JSON blob sets: "8" < "10" lexicographically.
    const { rows } = await query([
      { propertyId: estimate.toString(), op: "gt", value: "4" },
    ]);
    expect(titles(rows).sort()).toEqual(["Alpha", "Bravo"]);
  });

  it("compares dates as dates", async () => {
    const { rows } = await query([
      { propertyId: due.toString(), op: "lt", value: "2026-02-01" },
    ]);
    expect(titles(rows)).toEqual(["Alpha"]);
  });

  it("finds rows with nothing in a column, and rows with something", async () => {
    const empty = await query([{ propertyId: due.toString(), op: "is_empty", value: null }]);
    expect(titles(empty.rows).sort()).toEqual(["Bravo", "Delta"]);

    const filled = await query([{ propertyId: due.toString(), op: "not_empty", value: null }]);
    expect(titles(filled.rows).sort()).toEqual(["Alpha", "Charlie"]);
  });

  it("treats a checkbox as set or unset rather than as text", async () => {
    const { rows } = await query([
      { propertyId: done.toString(), op: "equals", value: "true" },
    ]);
    expect(titles(rows)).toEqual(["Charlie"]);
  });

  it("matches nothing when the value cannot be cast", async () => {
    // Dropping the filter would silently show every row instead.
    const { rows } = await query([
      { propertyId: estimate.toString(), op: "equals", value: "not a number" },
    ]);
    expect(rows).toEqual([]);
  });

  it("sorts by a property, ascending and descending", async () => {
    const up = await query([], [{ propertyId: estimate.toString(), direction: "asc" }]);
    expect(titles(up.rows)).toEqual(["Charlie", "Bravo", "Alpha", "Delta"]);

    const down = await query([], [{ propertyId: estimate.toString(), direction: "desc" }]);
    // Blanks stay last in both directions: a blank is "not filled in", not
    // "smallest", and burying it hides the rows most likely to need attention.
    expect(titles(down.rows)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("applies several sorts with the first one winning", async () => {
    const { rows } = await query(
      [],
      [
        { propertyId: done.toString(), direction: "desc" },
        { propertyId: estimate.toString(), direction: "asc" },
      ],
    );
    expect(titles(rows)[0]).toBe("Charlie");
  });

  it("ignores a filter naming a property that no longer exists", async () => {
    const { rows } = await query([{ propertyId: "999999", op: "equals", value: "x" }]);
    expect(rows).toHaveLength(4);
  });

  it("counts what matched even when the limit cuts the list", async () => {
    const { rows, total } = await queryDatabaseRows(prisma, root, {
      userId,
      filters: [],
      sorts: [],
      limit: 2,
    });
    expect(rows).toHaveLength(2);
    expect(total).toBe(4);
  });

  it("leaves trashed children out", async () => {
    const gone = await makeRow("Echo", {});
    await prisma.page.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const { rows } = await query();
    expect(titles(rows)).not.toContain("Echo");
    await prisma.page.update({ where: { id: gone.id }, data: { deletedAt: null } });
  });
});

describe("getDatabaseView", () => {
  it("is null for an ordinary page", async () => {
    expect(await getDatabaseView(prisma, root, userId)).toBeNull();
  });

  it("returns columns in the configured order, not the schema's", async () => {
    await prisma.pageDatabase.create({
      data: {
        pageId: root,
        columns: [estimate, status],
        filters: [],
        sorts: [{ propertyId: estimate.toString(), direction: "asc" }],
        createdBy: userId,
      },
    });

    const view = await getDatabaseView(prisma, root, userId);
    expect(view!.columns.map((column) => column.name)).toEqual(["Estimate", "Status"]);
    expect(view!.rows[0].title).toBe("Charlie");
    expect(view!.total).toBe(5);
  });

  it("drops a column whose property was deleted, without failing the view", async () => {
    const doomed = await prisma.pageProperty.create({
      data: {
        spaceId,
        name: "Temporary",
        type: "TEXT",
        ord: ORDER_KEY_START,
        createdBy: userId,
      },
    });
    await prisma.pageDatabase.update({
      where: { pageId: root },
      data: { columns: [estimate, doomed.id, status] },
    });
    await prisma.pageProperty.delete({ where: { id: doomed.id } });

    const view = await getDatabaseView(prisma, root, userId);
    expect(view!.columns.map((column) => column.name)).toEqual(["Estimate", "Status"]);
  });
});

describe("who may see a row", () => {
  /**
   * The regression this exists for: the first cut of the view skipped the read
   * filter, reasoning that page grants only widen access so a child of a
   * readable page is readable. `getEffectivePageLevel` resolves the grant on
   * *that page* with no walk up the closure table, so that is false — and the
   * table would have disclosed the titles, values and count of pages the
   * caller cannot open.
   */
  it("withholds children the caller cannot open, and does not count them", async () => {
    const space = await prisma.space.create({
      data: { key: "db-private", name: "Private DB", visibility: "PRIVATE" },
    });
    await prisma.spaceMember.create({ data: { spaceId: space.id, userId, permLevel: "ADMIN" } });
    const outsider = await prisma.appUser.create({
      data: {
        oidcSubject: "test|db-outsider",
        email: "db-outsider@test.io",
        displayName: "Outsider",
      },
    });

    const make = (title: string, parentId?: string) =>
      createPage(prisma, {
        spaceId: space.id,
        parentId: parentId ?? null,
        title,
        slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`,
        createdBy: userId,
      });

    const hub = await make("Hub");
    const shared = await make("Shared row", hub.id);
    await make("Secret row", hub.id);

    // The outsider is let into the database page and one of its rows.
    await prisma.pagePermission.createMany({
      data: [
        { pageId: hub.id, userId: outsider.id, permLevel: "VIEW", grantedBy: userId },
        { pageId: shared.id, userId: outsider.id, permLevel: "VIEW", grantedBy: userId },
      ],
    });

    const asOutsider = await queryDatabaseRows(prisma, hub.id, {
      userId: outsider.id,
      filters: [],
      sorts: [],
      limit: 100,
    });
    expect(titles(asOutsider.rows)).toEqual(["Shared row"]);
    // "Showing 1 of 2" would disclose exactly what was just withheld.
    expect(asOutsider.total).toBe(1);

    const asMember = await queryDatabaseRows(prisma, hub.id, {
      userId,
      filters: [],
      sorts: [],
      limit: 100,
    });
    expect(titles(asMember.rows)).toEqual(["Shared row", "Secret row"]);
    expect(asMember.total).toBe(2);
  });
});
