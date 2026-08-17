import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPage, movePage, PageMoveError, reorderPage } from "../src/closure.js";
import { TEST_URL } from "./global-setup.js";

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let spaceId: bigint;
let otherSpaceId: bigint;
let userId: bigint;

const make = (title: string, parentId?: string | null, space?: bigint) =>
  createPage(prisma, {
    spaceId: space ?? spaceId,
    parentId: parentId ?? null,
    title,
    slug: `${title.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
    createdBy: userId,
  });

/** The sibling group as the API serves it: (ord, id). */
async function order(parentId: string | null, space?: bigint): Promise<string[]> {
  const rows = await prisma.page.findMany({
    where: { spaceId: space ?? spaceId, parentId, deletedAt: null },
    orderBy: [{ ord: "asc" }, { id: "asc" }],
    select: { title: true },
  });
  return rows.map((row) => row.title);
}

beforeAll(async () => {
  const user = await prisma.appUser.create({
    data: { oidcSubject: "test|order", email: "order@test.io", displayName: "Order Tester" },
  });
  userId = user.id;
  spaceId = (await prisma.space.create({ data: { key: "order-test", name: "Order Test" } })).id;
  otherSpaceId = (
    await prisma.space.create({ data: { key: "order-other", name: "Order Other" } })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createPage", () => {
  it("appends each new page to the end of its sibling group", async () => {
    const root = await make("Append root");
    await make("First", root.id);
    await make("Second", root.id);
    await make("Third", root.id);
    expect(await order(root.id)).toEqual(["First", "Second", "Third"]);
  });

  it("gives siblings keys the database itself sorts the same way", async () => {
    // The column is COLLATE "C" for this: under a locale collation the
    // database orders these keys differently from the generator that made
    // them, and the tree comes back shuffled.
    const root = await make("Collation root");
    const titles = ["A", "B", "C", "D", "E", "F"];
    for (const title of titles) await make(title, root.id);
    const page = await prisma.page.findFirst({ where: { title: "A", parentId: root.id } });
    await reorderPage(prisma, page!.id, null);

    const rows = await prisma.page.findMany({
      where: { parentId: root.id },
      orderBy: [{ ord: "asc" }, { id: "asc" }],
      select: { title: true, ord: true },
    });
    const inJs = [...rows].sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0));
    expect(rows.map((r) => r.title)).toEqual(inJs.map((r) => r.title));
  });
});

describe("reorderPage", () => {
  it("moves a page to the front of its group", async () => {
    const root = await make("Front root");
    await make("One", root.id);
    await make("Two", root.id);
    const three = await make("Three", root.id);

    await reorderPage(prisma, three.id, null);
    expect(await order(root.id)).toEqual(["Three", "One", "Two"]);
  });

  it("moves a page to sit after a named sibling", async () => {
    const root = await make("Middle root");
    const one = await make("One", root.id);
    await make("Two", root.id);
    const three = await make("Three", root.id);

    await reorderPage(prisma, three.id, one.id);
    expect(await order(root.id)).toEqual(["One", "Three", "Two"]);
  });

  it("touches one row and leaves every sibling's key alone", async () => {
    const root = await make("Stable root");
    const one = await make("One", root.id);
    const two = await make("Two", root.id);
    const three = await make("Three", root.id);
    const before = new Map(
      (
        await prisma.page.findMany({
          where: { id: { in: [one.id, two.id] } },
          select: { id: true, ord: true },
        })
      ).map((row) => [row.id, row.ord]),
    );

    await reorderPage(prisma, three.id, one.id);

    const after = await prisma.page.findMany({
      where: { id: { in: [one.id, two.id] } },
      select: { id: true, ord: true },
    });
    for (const row of after) expect(row.ord).toBe(before.get(row.id));
  });

  it("orders roots within their space, which have no parent to group them", async () => {
    const a = await make("Root A", null, otherSpaceId);
    await make("Root B", null, otherSpaceId);
    const c = await make("Root C", null, otherSpaceId);

    await reorderPage(prisma, c.id, a.id);
    expect(await order(null, otherSpaceId)).toEqual(["Root A", "Root C", "Root B"]);
  });

  it("survives a hundred reorders into the same gap", async () => {
    const root = await make("Churn root");
    const first = await make("Pin one", root.id);
    await make("Pin two", root.id);
    const mover = await make("Mover", root.id);

    for (let i = 0; i < 100; i++) await reorderPage(prisma, mover.id, first.id);
    expect(await order(root.id)).toEqual(["Pin one", "Mover", "Pin two"]);
  });

  it("refuses an anchor that is not a sibling", async () => {
    const root = await make("Anchor root");
    const child = await make("Child", root.id);
    const elsewhere = await make("Elsewhere");

    await expect(reorderPage(prisma, child.id, elsewhere.id)).rejects.toBeInstanceOf(PageMoveError);
  });

  it("refuses to make a page follow itself", async () => {
    const page = await make("Self");
    await expect(reorderPage(prisma, page.id, page.id)).rejects.toBeInstanceOf(PageMoveError);
  });

  it("steps over trashed siblings, which the caller could not see", async () => {
    const root = await make("Trash root");
    const one = await make("Live one", root.id);
    const gone = await make("Trashed", root.id);
    const two = await make("Live two", root.id);
    await prisma.page.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    await reorderPage(prisma, two.id, null);
    expect(await order(root.id)).toEqual(["Live two", "Live one"]);
    // The trashed page kept its key, so restoring it puts it back in place.
    const restored = await prisma.page.findUnique({ where: { id: gone.id } });
    const original = await prisma.page.findUnique({ where: { id: one.id } });
    expect(restored!.ord > original!.ord).toBe(true);
  });
});

describe("movePage", () => {
  it("appends the moved page to the end of its new group", async () => {
    const from = await make("From root");
    const to = await make("To root");
    await make("Existing", to.id);
    const mover = await make("Mover", from.id);

    await movePage(prisma, mover.id, to.id);
    expect(await order(to.id)).toEqual(["Existing", "Mover"]);
  });

  it("carries a subtree's internal order across a space boundary", async () => {
    const root = await make("Carrier");
    const a = await make("Carried A", root.id);
    await make("Carried B", root.id);
    await make("Carried C", root.id);
    // Reorder inside the subtree first: the move must not resort it.
    await reorderPage(prisma, a.id, null);
    const inside = await order(root.id);

    await movePage(prisma, root.id, null, otherSpaceId);
    expect(await order(root.id, otherSpaceId)).toEqual(inside);
  });
});
