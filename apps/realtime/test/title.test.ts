import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { SignJWT } from "jose";
import { Redis } from "ioredis";
import * as Y from "yjs";
import { applyTextDiff, TITLE_FIELD, ydocTitle } from "@angy/blocks";
import { getPrisma } from "@angy/db";
import { DOC_COMMAND_CHANNEL, type RenameCommand } from "@angy/shared";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";

/**
 * Wave F: the title is a Y.Text in the page's own Y.Doc. These cover the two
 * halves that can silently diverge — the one-time seed for docs that predate
 * the field, and the store path copying the doc's title back into Postgres.
 */

const PORT = 3981;
const URL = `ws://127.0.0.1:${PORT}`;
const prisma = getPrisma();

let server: ReturnType<typeof buildServer>;
let spaceId: bigint;
let userId: bigint;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mintToken(page: string): Promise<string> {
  return new SignJWT({ page, name: "Title Tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId.toString())
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(env.jwtSecret()));
}

async function makePage(title: string): Promise<string> {
  const page = await prisma.page.create({
    data: {
      spaceId,
      title,
      slug: `title-${Date.now()}-${Math.round(performance.now())}`,
      createdBy: userId,
      documentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
      },
    },
  });
  return page.id;
}

async function open(pageId: string): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: URL,
    name: pageId,
    document: doc,
    token: await mintToken(pageId),
  });
  await new Promise<void>((resolve, reject) => {
    if (provider.synced) return resolve();
    const timer = setTimeout(() => reject(new Error("sync timeout")), 10000);
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { doc, provider };
}

beforeAll(async () => {
  const user = await prisma.appUser.upsert({
    where: { oidcSubject: "test|title" },
    update: {},
    create: { oidcSubject: "test|title", email: "title@test.io", displayName: "Title Tester" },
  });
  userId = user.id;
  const space = await prisma.space.upsert({
    where: { key: "title-test" },
    update: {},
    create: { key: "title-test", name: "Title Test" },
  });
  spaceId = space.id;
  await prisma.spaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId } },
    update: { permLevel: "EDIT" },
    create: { spaceId, userId, permLevel: "EDIT" },
  });
  server = buildServer(PORT);
  await server.listen();
});

afterAll(async () => {
  await server.destroy();
  await prisma.page.deleteMany({ where: { spaceId } });
  await prisma.$disconnect();
});

describe("collaborative title", () => {
  it("seeds the title from page.title for a doc that predates the field", async () => {
    const pageId = await makePage("Storage Model");
    const { doc, provider } = await open(pageId);
    expect(ydocTitle(doc)).toBe("Storage Model");
    provider.destroy();
  });

  it("writes an edited title back to page.title on store", async () => {
    const pageId = await makePage("Before");
    const { doc, provider } = await open(pageId);
    applyTextDiff(doc.getText(TITLE_FIELD), "After");

    await expect
      .poll(
        async () =>
          (await prisma.page.findUnique({ where: { id: pageId }, select: { title: true } }))
            ?.title,
        { timeout: 15000, interval: 500 },
      )
      .toBe("After");
    provider.destroy();
  });

  it("never writes an empty title — the row keeps its last good value", async () => {
    const pageId = await makePage("Keep Me");
    const { doc, provider } = await open(pageId);
    applyTextDiff(doc.getText(TITLE_FIELD), "");
    // Long enough for the 2s store debounce to fire.
    await sleep(5000);
    const row = await prisma.page.findUnique({ where: { id: pageId }, select: { title: true } });
    expect(row?.title).toBe("Keep Me");
    provider.destroy();
  });

  it("converges a title edit across two connected clients", async () => {
    const pageId = await makePage("Shared");
    const a = await open(pageId);
    const b = await open(pageId);
    applyTextDiff(a.doc.getText(TITLE_FIELD), "Shared Runbook");

    await expect
      .poll(() => ydocTitle(b.doc), { timeout: 10000, interval: 200 })
      .toBe("Shared Runbook");
    a.provider.destroy();
    b.provider.destroy();
  });

  it("applies a REST rename through the doc-command channel", async () => {
    const pageId = await makePage("Rename Me");
    const { doc, provider } = await open(pageId);

    const publisher = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    const command: RenameCommand = {
      type: "rename",
      pageId,
      title: "Renamed By API",
      userId: userId.toString(),
    };
    await publisher.publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));
    publisher.disconnect();

    // The live editor sees it, and it reaches Postgres through the same store
    // path as a keystroke — never written directly by the API.
    await expect
      .poll(() => ydocTitle(doc), { timeout: 10000, interval: 200 })
      .toBe("Renamed By API");
    await expect
      .poll(
        async () =>
          (await prisma.page.findUnique({ where: { id: pageId }, select: { title: true } }))
            ?.title,
        { timeout: 15000, interval: 500 },
      )
      .toBe("Renamed By API");
    provider.destroy();
  });
});
