import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  findStaleReferrers,
  getBacklinks,
  refLabel,
  replaceBlockIndex,
  type BlockRefInput,
} from "../src/block-index.js";
import { createPage } from "../src/closure.js";
import { TEST_URL } from "./global-setup.js";

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let userId: bigint;
let spaceId: bigint;
/** The link target every other page in these tests points at. */
let target: string;
let sourceA: string;
let sourceB: string;

const linkTo = (pageId: string, label: string, ord = 0): BlockRefInput => ({
  ord,
  kind: "PAGE_LINK",
  targetPageId: pageId,
  targetUserId: null,
  payload: { label },
});

const newPage = async (title: string, slug: string) =>
  (await createPage(prisma, { spaceId, title, slug, createdBy: userId })).id;

beforeAll(async () => {
  const user = await prisma.appUser.create({
    data: { oidcSubject: "test|refs", email: "refs@test.io", displayName: "Linker" },
  });
  userId = user.id;
  const space = await prisma.space.create({ data: { key: "refs-test", name: "Refs Test" } });
  spaceId = space.id;
  target = await newPage("Architecture", "architecture");
  sourceA = await newPage("Runbook", "runbook");
  sourceB = await newPage("Onboarding", "onboarding");
});

afterAll(() => prisma.$disconnect());

describe("replaceBlockIndex", () => {
  it("replaces a page's rows wholesale rather than accumulating", async () => {
    await replaceBlockIndex(prisma, sourceA, [linkTo(target, "Architecture")]);
    await replaceBlockIndex(prisma, sourceA, [
      linkTo(target, "Architecture"),
      linkTo(target, "Architecture", 1),
    ]);
    expect(await prisma.blockIndex.count({ where: { pageId: sourceA } })).toBe(2);

    // Rebuilding a document whose links were deleted must leave nothing behind.
    await replaceBlockIndex(prisma, sourceA, []);
    expect(await prisma.blockIndex.count({ where: { pageId: sourceA } })).toBe(0);
  });

  it("is safe to re-run — the projection must stay rebuildable", async () => {
    const refs = [linkTo(target, "Architecture")];
    await replaceBlockIndex(prisma, sourceA, refs);
    await replaceBlockIndex(prisma, sourceA, refs);
    const rows = await prisma.blockIndex.findMany({ where: { pageId: sourceA } });
    expect(rows).toHaveLength(1);
    expect(refLabel(rows[0]!.payload)).toBe("Architecture");
  });

  it("goes with the page when it is hard-deleted", async () => {
    const doomed = await newPage("Doomed", "doomed");
    await replaceBlockIndex(prisma, doomed, [linkTo(target, "Architecture")]);
    await prisma.page.delete({ where: { id: doomed } });
    expect(await prisma.blockIndex.count({ where: { pageId: doomed } })).toBe(0);
  });

  it("drops rows pointing at a hard-deleted target", async () => {
    const ghost = await newPage("Ghost", "ghost");
    await replaceBlockIndex(prisma, sourceA, [linkTo(ghost, "Ghost")]);
    await prisma.page.delete({ where: { id: ghost } });
    expect(await prisma.blockIndex.count({ where: { targetPageId: ghost } })).toBe(0);
  });
});

describe("findStaleReferrers", () => {
  beforeAll(async () => {
    await replaceBlockIndex(prisma, sourceA, [linkTo(target, "Architecture")]);
    await replaceBlockIndex(prisma, sourceB, [linkTo(target, "Architecture")]);
  });

  it("finds nobody while every rendered label still matches", async () => {
    expect(await findStaleReferrers(prisma, target, "Architecture")).toEqual([]);
  });

  it("finds every page rendering the old name after a rename", async () => {
    const stale = await findStaleReferrers(prisma, target, "System Architecture");
    expect(stale.sort()).toEqual([sourceA, sourceB].sort());
  });

  it("reports a page once however many times it links", async () => {
    await replaceBlockIndex(prisma, sourceA, [
      linkTo(target, "Architecture"),
      linkTo(target, "Architecture", 1),
      linkTo(target, "Architecture", 2),
    ]);
    expect(await findStaleReferrers(prisma, target, "Renamed")).toContain(sourceA);
    expect((await findStaleReferrers(prisma, target, "Renamed")).filter((id) => id === sourceA))
      .toHaveLength(1);
  });

  it("stops reporting a page once its rebuild recorded the new label", async () => {
    await replaceBlockIndex(prisma, sourceA, [linkTo(target, "System Architecture")]);
    const stale = await findStaleReferrers(prisma, target, "System Architecture");
    expect(stale).not.toContain(sourceA);
    // ...and the page that has not caught up yet is still listed.
    expect(stale).toContain(sourceB);
  });

  it("skips trashed referrers — they render nowhere", async () => {
    await prisma.page.update({ where: { id: sourceB }, data: { deletedAt: new Date() } });
    expect(await findStaleReferrers(prisma, target, "Anything At All")).not.toContain(sourceB);
    await prisma.page.update({ where: { id: sourceB }, data: { deletedAt: null } });
  });
});

describe("getBacklinks", () => {
  beforeAll(async () => {
    await replaceBlockIndex(prisma, sourceA, [
      linkTo(target, "Architecture"),
      linkTo(target, "Architecture", 1),
    ]);
    await replaceBlockIndex(prisma, sourceB, [linkTo(target, "Architecture")]);
  });

  it("groups repeated links into one backlink with a count", async () => {
    const backlinks = await getBacklinks(prisma, target);
    expect(backlinks.map((b) => b.pageId).sort()).toEqual([sourceA, sourceB].sort());
    expect(backlinks.find((b) => b.pageId === sourceA)?.count).toBe(2);
    expect(backlinks.find((b) => b.pageId === sourceB)?.count).toBe(1);
    expect(backlinks.find((b) => b.pageId === sourceA)?.title).toBe("Runbook");
  });

  it("omits trashed pages", async () => {
    await prisma.page.update({ where: { id: sourceB }, data: { deletedAt: new Date() } });
    const backlinks = await getBacklinks(prisma, target);
    expect(backlinks.map((b) => b.pageId)).not.toContain(sourceB);
    await prisma.page.update({ where: { id: sourceB }, data: { deletedAt: null } });
  });

  it("omits a page's links to itself", async () => {
    await replaceBlockIndex(prisma, target, [linkTo(target, "Architecture")]);
    expect((await getBacklinks(prisma, target)).map((b) => b.pageId)).not.toContain(target);
  });

  it("is empty for a page nothing links to", async () => {
    const lonely = await newPage("Lonely", "lonely");
    expect(await getBacklinks(prisma, lonely)).toEqual([]);
  });
});
