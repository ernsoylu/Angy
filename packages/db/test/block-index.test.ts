import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  findStaleReferrers,
  getBacklinks,
  getMentions,
  getTasks,
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

describe("getMentions", () => {
  const mentionOf = (userId: bigint, label: string, ord = 0): BlockRefInput => ({
    ord,
    kind: "MENTION",
    targetPageId: null,
    targetUserId: userId.toString(),
    payload: { label },
  });

  let other: bigint;
  let mentioning: string;

  beforeAll(async () => {
    const stranger = await prisma.appUser.create({
      data: { oidcSubject: "test|refs2", email: "refs2@test.io", displayName: "Stranger" },
    });
    other = stranger.id;
    mentioning = await newPage("Standup Notes", "standup-notes");
    await replaceBlockIndex(prisma, mentioning, [
      mentionOf(userId, "Linker"),
      mentionOf(userId, "Linker", 1),
    ]);
  });

  it("finds pages naming the user, collapsing repeats into a count", async () => {
    const mentions = await getMentions(prisma, userId);
    const row = mentions.find((m) => m.pageId === mentioning);
    expect(row?.title).toBe("Standup Notes");
    expect(row?.count).toBe(2);
  });

  it("does not leak one user's mentions to another", async () => {
    expect((await getMentions(prisma, other)).map((m) => m.pageId)).not.toContain(mentioning);
  });

  it("scopes to a space when asked", async () => {
    expect((await getMentions(prisma, userId, spaceId)).map((m) => m.pageId)).toContain(mentioning);
    // A space that exists but holds none of them.
    const elsewhere = await prisma.space.create({
      data: { key: "refs-elsewhere", name: "Elsewhere" },
    });
    expect(await getMentions(prisma, userId, elsewhere.id)).toEqual([]);
  });

  it("omits trashed pages", async () => {
    await prisma.page.update({ where: { id: mentioning }, data: { deletedAt: new Date() } });
    expect((await getMentions(prisma, userId)).map((m) => m.pageId)).not.toContain(mentioning);
    await prisma.page.update({ where: { id: mentioning }, data: { deletedAt: null } });
  });

  it("does not return tasks assigned to the user as mentions", async () => {
    // A task carries its assignee in target_user_id too; only `kind` separates
    // them, so a mentions query keyed on the column alone would return to-dos.
    const board = await newPage("Has Tasks", "has-tasks");
    await replaceBlockIndex(prisma, board, [
      { ord: 0, kind: "TASK", targetPageId: null, targetUserId: userId.toString(), payload: { label: "Do it", done: false } },
    ]);
    expect((await getMentions(prisma, userId)).map((m) => m.pageId)).not.toContain(board);
  });

  it("does not confuse a mention with a link to the same numeric id", async () => {
    // target_page_id and target_user_id are separate columns; a query keyed on
    // the wrong one would return page links as mentions.
    const linker = await newPage("Just A Link", "just-a-link");
    await replaceBlockIndex(prisma, linker, [linkTo(target, "Architecture")]);
    expect((await getMentions(prisma, userId)).map((m) => m.pageId)).not.toContain(linker);
  });
});

describe("getTasks", () => {
  const task = (
    ord: number,
    text: string,
    done: boolean,
    assignee?: bigint,
  ): BlockRefInput => ({
    ord,
    kind: "TASK",
    targetPageId: null,
    targetUserId: assignee ? assignee.toString() : null,
    payload: { label: text, done },
  });

  let board: string;

  beforeAll(async () => {
    board = await newPage("Sprint Board", "sprint-board");
    await replaceBlockIndex(prisma, board, [
      task(0, "Open one", false),
      task(1, "Done one", true),
      task(2, "Mine", false, userId),
    ]);
  });

  it("returns open tasks only by default", async () => {
    const tasks = await getTasks(prisma, spaceId, { openOnly: true });
    const texts = tasks.filter((t) => t.pageId === board).map((t) => t.text);
    expect(texts).toEqual(["Open one", "Mine"]);
  });

  it("includes finished ones when asked", async () => {
    const tasks = await getTasks(prisma, spaceId);
    expect(tasks.filter((t) => t.pageId === board).map((t) => t.text)).toContain("Done one");
  });

  it("keeps each page's tasks in document order", async () => {
    const tasks = (await getTasks(prisma, spaceId)).filter((t) => t.pageId === board);
    expect(tasks.map((t) => t.ord)).toEqual([0, 1, 2]);
  });

  it("narrows to one assignee", async () => {
    const mine = await getTasks(prisma, spaceId, { assigneeId: userId });
    // Scoped to this board: earlier specs leave their own assigned tasks in
    // the shared space, and this assertion is about the filter, not the space.
    expect(mine.filter((t) => t.pageId === board).map((t) => t.text)).toEqual(["Mine"]);
    expect(mine.every((t) => t.assigneeId === userId)).toBe(true);
    // The unassigned ones on the same page are excluded.
    expect(mine.map((t) => t.text)).not.toContain("Open one");
  });

  it("carries the page it came from, so a board can link back", async () => {
    const tasks = (await getTasks(prisma, spaceId)).filter((t) => t.pageId === board);
    expect(tasks[0]?.pageTitle).toBe("Sprint Board");
  });

  it("omits trashed pages", async () => {
    await prisma.page.update({ where: { id: board }, data: { deletedAt: new Date() } });
    expect((await getTasks(prisma, spaceId)).map((t) => t.pageId)).not.toContain(board);
    await prisma.page.update({ where: { id: board }, data: { deletedAt: null } });
  });

  it("does not return links or mentions as tasks", async () => {
    const mixed = await newPage("Mixed", "mixed");
    await replaceBlockIndex(prisma, mixed, [
      linkTo(target, "Architecture"),
      { ord: 1, kind: "MENTION", targetPageId: null, targetUserId: userId.toString(), payload: { label: "Linker" } },
    ]);
    expect((await getTasks(prisma, spaceId)).map((t) => t.pageId)).not.toContain(mixed);
  });
});
