import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPage } from "../src/closure.js";
import { isPageStarred, recordPageVisit } from "../src/personal.js";
import { TEST_URL } from "./global-setup.js";

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let spaceId: bigint;
let userId: bigint;
let otherUserId: bigint;
let pageId: string;

beforeAll(async () => {
  const [user, other] = await Promise.all([
    prisma.appUser.create({
      data: { oidcSubject: "test|personal", email: "personal@test.io", displayName: "Visitor" },
    }),
    prisma.appUser.create({
      data: { oidcSubject: "test|personal2", email: "personal2@test.io", displayName: "Other" },
    }),
  ]);
  const space = await prisma.space.create({
    data: { key: "personal-test", name: "Personal Test" },
  });
  userId = user.id;
  otherUserId = other.id;
  spaceId = space.id;
  const page = await createPage(prisma, {
    spaceId,
    title: "Visited",
    slug: "visited",
    createdBy: userId,
  });
  pageId = page.id;
});

afterAll(() => prisma.$disconnect());

describe("reading history", () => {
  it("records the first visit", async () => {
    expect(await recordPageVisit(prisma, userId, pageId)).toBe(true);
    const row = await prisma.pageVisit.findUnique({
      where: { userId_pageId: { userId, pageId } },
    });
    expect(row?.visits).toBe(1);
  });

  it("throttles repeat visits inside the window", async () => {
    const before = await prisma.pageVisit.findUnique({
      where: { userId_pageId: { userId, pageId } },
    });
    for (let i = 0; i < 5; i++) {
      expect(await recordPageVisit(prisma, userId, pageId)).toBe(false);
    }
    const after = await prisma.pageVisit.findUnique({
      where: { userId_pageId: { userId, pageId } },
    });
    expect(after?.visits).toBe(1);
    expect(after?.visitedAt.toISOString()).toBe(before?.visitedAt.toISOString());
  });

  it("records again once the window has passed", async () => {
    // A zero-length window is the same code path a stale row takes.
    expect(await recordPageVisit(prisma, userId, pageId, 0)).toBe(true);
    const row = await prisma.pageVisit.findUnique({
      where: { userId_pageId: { userId, pageId } },
    });
    expect(row?.visits).toBe(2);
  });

  it("keeps each user's history separate", async () => {
    expect(await recordPageVisit(prisma, otherUserId, pageId)).toBe(true);
    const rows = await prisma.pageVisit.findMany({ where: { pageId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.userId === otherUserId)?.visits).toBe(1);
  });
});

describe("stars", () => {
  it("is false until starred, and per-user", async () => {
    expect(await isPageStarred(prisma, userId, pageId)).toBe(false);
    await prisma.pageStar.create({ data: { userId, pageId } });
    expect(await isPageStarred(prisma, userId, pageId)).toBe(true);
    expect(await isPageStarred(prisma, otherUserId, pageId)).toBe(false);
  });
});
