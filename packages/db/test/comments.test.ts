import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPage } from "../src/closure.js";
import { commentAudience, raiseCommentNotifications, syncCommentAnchors } from "../src/comments.js";
import { TEST_URL } from "./global-setup.js";

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let spaceId: bigint;
let author: bigint;
let replier: bigint;
let editor: bigint;

const makePage = (title: string, updatedBy?: bigint) =>
  createPage(prisma, {
    spaceId,
    title,
    slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`,
    createdBy: updatedBy ?? author,
  });

async function makeThread(pageId: string, by = author) {
  return prisma.commentThread.create({
    data: {
      pageId,
      anchorText: "the sentence in question",
      createdBy: by,
      comments: { create: { authorId: by, body: "Is this still true?" } },
    },
  });
}

beforeAll(async () => {
  const users = await Promise.all(
    ["author", "replier", "editor"].map((name, index) =>
      prisma.appUser.create({
        data: {
          oidcSubject: `test|comment-${name}-${index}`,
          email: `comment-${name}@test.io`,
          displayName: `Comment ${name}`,
        },
      }),
    ),
  );
  [author, replier, editor] = users.map((user) => user.id);
  spaceId = (await prisma.space.create({ data: { key: "comment-test", name: "Comments" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("syncCommentAnchors", () => {
  it("flags a thread whose mark is no longer in the document", async () => {
    const page = await makePage("Orphan page");
    const thread = await makeThread(page.id);

    const result = await syncCommentAnchors(prisma, page.id, []);
    expect(result.orphaned).toBe(1);
    const after = await prisma.commentThread.findUnique({ where: { id: thread.id } });
    expect(after!.orphanedAt).not.toBeNull();
  });

  it("leaves an anchored thread alone", async () => {
    const page = await makePage("Anchored page");
    const thread = await makeThread(page.id);

    const result = await syncCommentAnchors(prisma, page.id, [thread.id]);
    expect(result.orphaned).toBe(0);
    const after = await prisma.commentThread.findUnique({ where: { id: thread.id } });
    expect(after!.orphanedAt).toBeNull();
  });

  it("revives a thread whose text came back", async () => {
    // An undo, or a revision restore. A thread that apologises for itself
    // forever after the text returns is worse than one that never flagged.
    const page = await makePage("Undo page");
    const thread = await makeThread(page.id);

    await syncCommentAnchors(prisma, page.id, []);
    const result = await syncCommentAnchors(prisma, page.id, [thread.id]);

    expect(result.revived).toBe(1);
    const after = await prisma.commentThread.findUnique({ where: { id: thread.id } });
    expect(after!.orphanedAt).toBeNull();
  });

  it("is idempotent, because a projection rebuild is not a single event", async () => {
    const page = await makePage("Rebuild page");
    await makeThread(page.id);

    expect((await syncCommentAnchors(prisma, page.id, [])).orphaned).toBe(1);
    expect((await syncCommentAnchors(prisma, page.id, [])).orphaned).toBe(0);
  });

  it("never touches another page's threads", async () => {
    const mine = await makePage("Mine");
    const theirs = await makePage("Theirs");
    const other = await makeThread(theirs.id);

    await syncCommentAnchors(prisma, mine.id, []);
    const after = await prisma.commentThread.findUnique({ where: { id: other.id } });
    expect(after!.orphanedAt).toBeNull();
  });
});

describe("commentAudience", () => {
  it("collects the thread's participants and the page's last editor", async () => {
    const page = await prisma.page.update({
      where: { id: (await makePage("Audience page")).id },
      data: { updatedBy: editor },
    });
    const thread = await makeThread(page.id);
    await prisma.comment.create({
      data: { threadId: thread.id, authorId: replier, body: "I think so." },
    });

    const audience = await commentAudience(prisma, thread.id, author);
    expect([...audience].sort()).toEqual([replier, editor].sort());
  });

  it("leaves out whoever is doing the talking", async () => {
    const page = await makePage("Self page");
    const thread = await makeThread(page.id);
    expect(await commentAudience(prisma, thread.id, author)).not.toContain(author);
  });

  it("collapses repeat comments into one inbox row per page", async () => {
    // The same judgement mentions make: ten remarks on one page is one thing
    // to go and look at.
    const page = await makePage("Inbox page");

    const first = await raiseCommentNotifications(prisma, page.id, [replier], author);
    const second = await raiseCommentNotifications(prisma, page.id, [replier], author);

    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
