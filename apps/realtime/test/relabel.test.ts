import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { SignJWT } from "jose";
import { Redis } from "ioredis";
import * as Y from "yjs";
import { extractRefs, ydocToJson } from "@angy/blocks";
import { getPrisma } from "@angy/db";
import { DOC_COMMAND_CHANNEL, type RelabelCommand } from "@angy/shared";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";

/**
 * Page-link labels in the *editor* (V2 H1).
 *
 * The reader never shows a stale label — the projection resolves it on the way
 * to rendered_html. The editor renders straight from the Y.Doc, so it does, and
 * only rewriting the node fixes it. Two paths cover that between them, and the
 * split is what keeps a rename off the critical path: documents already open
 * are rewritten in place, and everything else is repaired the next time it
 * loads. This asserts both, plus the property that makes them safe to run
 * unconditionally — an already-correct document is not touched.
 */

const PORT = 3984;
const URL = `ws://127.0.0.1:${PORT}`;
const prisma = getPrisma();

let server: ReturnType<typeof buildServer>;
let redis: Redis;
let spaceId: bigint;
let userId: bigint;
let target: string;

const label = (doc: Y.Doc) => extractRefs(ydocToJson(doc))[0]?.payload?.label;

async function mintToken(page: string): Promise<string> {
  return new SignJWT({ page, name: "Relabel Tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId.toString())
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(env.jwtSecret()));
}

/** A page whose document links to `target`, labelled as given. */
async function makeLinkingPage(title: string, linkLabel: string): Promise<string> {
  const page = await prisma.page.create({
    data: {
      spaceId,
      title,
      slug: `relabel-${Date.now()}-${Math.round(performance.now())}`,
      createdBy: userId,
      documentJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "See:" }] },
          { type: "pageLink", attrs: { pageId: target, title: linkLabel } },
        ],
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
    where: { oidcSubject: "test|relabel" },
    update: {},
    create: { oidcSubject: "test|relabel", email: "relabel@test.io", displayName: "Relabel Tester" },
  });
  userId = user.id;
  const space = await prisma.space.upsert({
    where: { key: "relabel-test" },
    update: {},
    create: { key: "relabel-test", name: "Relabel Test" },
  });
  spaceId = space.id;
  await prisma.spaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId } },
    update: { permLevel: "EDIT" },
    create: { spaceId, userId, permLevel: "EDIT" },
  });
  const targetPage = await prisma.page.create({
    data: { spaceId, title: "Architecture", slug: `relabel-target-${Date.now()}`, createdBy: userId },
  });
  target = targetPage.id;

  redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  server = buildServer(PORT);
  await server.listen();
});

afterAll(async () => {
  await server.destroy();
  redis.disconnect();
  await prisma.page.deleteMany({ where: { spaceId } });
  await prisma.$disconnect();
});

describe("page-link labels in the editor", () => {
  it("repairs a stale label when the document loads", async () => {
    // Authored before the rename — exactly the state every link left behind by
    // V1 is in, which is why load-time repair and not just a rename hook.
    const pageId = await makeLinkingPage("Operations", "Old Architecture Name");
    const { doc, provider } = await open(pageId);

    expect(label(doc)).toBe("Architecture");
    provider.destroy();
  });

  it("leaves a correct label alone, producing no update at all", async () => {
    const pageId = await makeLinkingPage("Already Right", "Architecture");
    const { doc, provider } = await open(pageId);

    // Loading a document must not be an edit: an update here would re-store,
    // re-project and eventually checkpoint a page nobody changed.
    let updates = 0;
    doc.on("update", () => updates++);
    expect(label(doc)).toBe("Architecture");
    expect(updates).toBe(0);
    provider.destroy();
  });

  it("relabels a document that is already open, without reopening it", async () => {
    const pageId = await makeLinkingPage("Live Editor", "Architecture");
    const { doc, provider } = await open(pageId);
    expect(label(doc)).toBe("Architecture");

    // The rename the worker observed, published as it publishes it.
    await prisma.page.update({ where: { id: target }, data: { title: "System Architecture" } });
    const command: RelabelCommand = {
      type: "relabel",
      targetPageId: target,
      title: "System Architecture",
    };
    await redis.publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));

    // The editing client converges on it like any other edit — no reload.
    await expect
      .poll(() => label(doc), { timeout: 15000, interval: 250 })
      .toBe("System Architecture");
    provider.destroy();
  });

  it("ignores a rename of a page it does not link to", async () => {
    const other = await prisma.page.create({
      data: { spaceId, title: "Unrelated", slug: `relabel-other-${Date.now()}`, createdBy: userId },
    });
    const pageId = await makeLinkingPage("Untouched", "System Architecture");
    const { doc, provider } = await open(pageId);

    let updates = 0;
    doc.on("update", () => updates++);
    const command: RelabelCommand = {
      type: "relabel",
      targetPageId: other.id,
      title: "Renamed Unrelated",
    };
    await redis.publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));
    await new Promise((r) => setTimeout(r, 1500));

    expect(updates).toBe(0);
    expect(label(doc)).toBe("System Architecture");
    provider.destroy();
  });
});
