import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ORDER_KEY_START } from "@angy/shared";
import {
  createPage,
  getBreadcrumb,
  movePage,
  PageMoveError,
  restorePage,
  trashPage,
} from "../src/closure.js";
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

beforeAll(async () => {
  const user = await prisma.appUser.create({
    data: { oidcSubject: "test|move", email: "move@test.io", displayName: "Move Tester" },
  });
  userId = user.id;
  spaceId = (await prisma.space.create({ data: { key: "move-test", name: "Move Test" } })).id;
  otherSpaceId = (
    await prisma.space.create({ data: { key: "move-other", name: "Move Other" } })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("movePage", () => {
  it("reparents a subtree and rebuilds every closure path", async () => {
    const a = await make("A");
    const b = await make("B", a.id);
    const c = await make("C", b.id);
    const target = await make("Target");

    await movePage(prisma, b.id, target.id);

    expect((await getBreadcrumb(prisma, c.id)).map((r) => r.title)).toEqual([
      "Target",
      "B",
      "C",
    ]);
    const stale = await prisma.pageAncestor.findMany({
      where: { ancestorId: a.id, descendantId: { in: [b.id, c.id] } },
    });
    expect(stale).toHaveLength(0);
    const depths = await prisma.pageAncestor.findUnique({
      where: { ancestorId_descendantId: { ancestorId: target.id, descendantId: c.id } },
    });
    expect(depths?.depth).toBe(2);
  });

  it("moves a page to the root", async () => {
    const parent = await make("Root parent");
    const child = await make("Promoted", parent.id);
    await movePage(prisma, child.id, null);
    expect((await getBreadcrumb(prisma, child.id)).map((r) => r.title)).toEqual(["Promoted"]);
    expect((await prisma.page.findUnique({ where: { id: child.id } }))?.parentId).toBeNull();
  });

  it("rejects moving a page into its own subtree (cycle check)", async () => {
    const top = await make("Top");
    const mid = await make("Mid", top.id);
    const leaf = await make("Leaf", mid.id);
    await expect(movePage(prisma, top.id, leaf.id)).rejects.toThrow(PageMoveError);
    await expect(movePage(prisma, top.id, top.id)).rejects.toThrow(PageMoveError);
  });

  it("moves a subtree into another space, carrying space_id and deduping slugs", async () => {
    const root = await make("Traveler");
    const kid = await make("Traveler kid", root.id);
    // A slug collision waiting in the target space.
    const clash = await prisma.page.create({
      data: {
        spaceId: otherSpaceId,
        title: "Clash",
        slug: root.slug,
        // Written directly rather than through createPage, so the sibling key
        // has to be supplied here.
        ord: ORDER_KEY_START,
        createdBy: userId,
      },
    });
    await prisma.pageAncestor.create({
      data: { ancestorId: clash.id, descendantId: clash.id, depth: 0 },
    });

    const result = await movePage(prisma, root.id, null, otherSpaceId);
    expect(result.spaceChanged).toBe(true);
    expect(result.movedIds.sort()).toEqual([root.id, kid.id].sort());

    const moved = await prisma.page.findMany({ where: { id: { in: result.movedIds } } });
    expect(moved.every((p) => p.spaceId === otherSpaceId)).toBe(true);
    const movedRoot = moved.find((p) => p.id === root.id)!;
    expect(movedRoot.slug).not.toBe(clash.slug); // de-duplicated
    expect((await getBreadcrumb(prisma, kid.id)).map((r) => r.title)).toEqual([
      "Traveler",
      "Traveler kid",
    ]);
  });

  it("moves under a parent in another space", async () => {
    const local = await make("Local child");
    const foreign = await make("Foreign parent", null, otherSpaceId);
    const result = await movePage(prisma, local.id, foreign.id);
    expect(result.spaceChanged).toBe(true);
    expect((await prisma.page.findUnique({ where: { id: local.id } }))?.spaceId).toBe(
      otherSpaceId,
    );
    expect((await getBreadcrumb(prisma, local.id)).map((r) => r.title)).toEqual([
      "Foreign parent",
      "Local child",
    ]);
  });
});

describe("trash & restore", () => {
  it("soft-deletes and restores a whole subtree, keeping its place in the tree", async () => {
    const root = await make("Trashable");
    const kid = await make("Trashable kid", root.id);

    const trashed = await trashPage(prisma, root.id, userId);
    expect(trashed.sort()).toEqual([root.id, kid.id].sort());
    const gone = await prisma.page.findMany({
      where: { id: { in: trashed }, deletedAt: { not: null } },
    });
    expect(gone).toHaveLength(2);

    await restorePage(prisma, root.id);
    const back = await prisma.page.findMany({ where: { id: { in: trashed }, deletedAt: null } });
    expect(back).toHaveLength(2);
    expect((await getBreadcrumb(prisma, kid.id)).map((r) => r.title)).toEqual([
      "Trashable",
      "Trashable kid",
    ]);
  });
});
