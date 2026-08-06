import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPage, getBreadcrumb, getSubtree } from "../src/closure.js";
import { TEST_URL } from "./global-setup.js";

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let spaceId: bigint;
let userId: bigint;

beforeAll(async () => {
  const user = await prisma.appUser.create({
    data: { oidcSubject: "test|closure", email: "closure@test.io", displayName: "Closure Tester" },
  });
  const space = await prisma.space.create({ data: { key: "closure-test", name: "Closure Test" } });
  userId = user.id;
  spaceId = space.id;
});

afterAll(() => prisma.$disconnect());

describe("page closure table", () => {
  it("writes a self-row for root pages", async () => {
    const root = await createPage(prisma, {
      spaceId,
      title: "Root",
      slug: "root",
      createdBy: userId,
    });
    const rows = await prisma.pageAncestor.findMany({ where: { descendantId: root.id } });
    expect(rows).toEqual([{ ancestorId: root.id, descendantId: root.id, depth: 0 }]);
  });

  it("registers all ancestors for nested pages", async () => {
    const a = await createPage(prisma, { spaceId, title: "A", slug: "a", createdBy: userId });
    const b = await createPage(prisma, {
      spaceId,
      parentId: a.id,
      title: "B",
      slug: "b",
      createdBy: userId,
    });
    const c = await createPage(prisma, {
      spaceId,
      parentId: b.id,
      title: "C",
      slug: "c",
      createdBy: userId,
    });

    const rows = await prisma.pageAncestor.findMany({
      where: { descendantId: c.id },
      orderBy: { depth: "asc" },
    });
    expect(rows).toEqual([
      { ancestorId: c.id, descendantId: c.id, depth: 0 },
      { ancestorId: b.id, descendantId: c.id, depth: 1 },
      { ancestorId: a.id, descendantId: c.id, depth: 2 },
    ]);
  });

  it("returns the subtree shallowest-first and skips trashed pages", async () => {
    const root = await createPage(prisma, {
      spaceId,
      title: "Tree",
      slug: "tree",
      createdBy: userId,
    });
    const kept = await createPage(prisma, {
      spaceId,
      parentId: root.id,
      title: "Kept",
      slug: "kept",
      createdBy: userId,
    });
    const trashed = await createPage(prisma, {
      spaceId,
      parentId: root.id,
      title: "Trashed",
      slug: "trashed",
      createdBy: userId,
    });
    await prisma.page.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });

    const subtree = await getSubtree(prisma, root.id);
    expect(subtree.map((r) => r.id)).toEqual([root.id, kept.id]);
    expect(subtree[0]?.depth).toBe(0);
  });

  it("builds a breadcrumb from root to leaf", async () => {
    const x = await createPage(prisma, { spaceId, title: "X", slug: "x", createdBy: userId });
    const y = await createPage(prisma, {
      spaceId,
      parentId: x.id,
      title: "Y",
      slug: "y",
      createdBy: userId,
    });

    const crumb = await getBreadcrumb(prisma, y.id);
    expect(crumb.map((r) => r.title)).toEqual(["X", "Y"]);
  });

  it("cascades closure rows when a page is hard-deleted", async () => {
    const root = await createPage(prisma, { spaceId, title: "Gone", slug: "gone", createdBy: userId });
    const child = await createPage(prisma, {
      spaceId,
      parentId: root.id,
      title: "Gone child",
      slug: "gone-child",
      createdBy: userId,
    });
    await prisma.page.delete({ where: { id: child.id } });
    await prisma.page.delete({ where: { id: root.id } });
    const rows = await prisma.pageAncestor.findMany({
      where: { OR: [{ ancestorId: root.id }, { descendantId: root.id }] },
    });
    expect(rows).toHaveLength(0);
  });
});
