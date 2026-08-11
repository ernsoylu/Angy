import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { SignJWT } from "jose";
import * as Y from "yjs";
import { getPrisma } from "@angy/db";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";

/**
 * onStoreDocument when the page row is gone.
 *
 * A page can be hard-deleted while a socket is still open — a trash purge or a
 * space purge does not ask who is editing. `page.update` throws P2025 there,
 * and Hocuspocus answers a failed store by keeping the document in memory "to
 * avoid data loss": the doc is then pinned for the life of the process and
 * replays the same failing write on every debounce. Seen in the realtime log of
 * a real CI run, where it survived every subsequent unload.
 */

const PORT = 3983;
const URL = `ws://127.0.0.1:${PORT}`;
const prisma = getPrisma();

let server: ReturnType<typeof buildServer>;
let spaceId: bigint;
let userId: bigint;

async function mintToken(page: string): Promise<string> {
  return new SignJWT({ page, name: "Store Tester" })
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
      slug: `store-${Date.now()}-${Math.round(performance.now())}`,
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
    where: { oidcSubject: "test|store" },
    update: {},
    create: { oidcSubject: "test|store", email: "store@test.io", displayName: "Store Tester" },
  });
  userId = user.id;
  const space = await prisma.space.upsert({
    where: { key: "store-test" },
    update: {},
    create: { key: "store-test", name: "Store Test" },
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

describe("document store", () => {
  it("releases a document whose page row was deleted mid-session", async () => {
    const pageId = await makePage("Doomed");
    const { doc, provider } = await open(pageId);
    doc.getXmlFragment("default").push([new Y.XmlElement("paragraph")]);

    // The purge a 30-day trash sweep would perform, with the socket still open.
    await prisma.page.deleteMany({ where: { id: pageId } });
    provider.destroy();

    // Unloading is the observable half: a store that throws leaves the document
    // in the map, so this poll is what separates "handled" from "pinned".
    await expect
      .poll(() => server.hocuspocus.documents.has(pageId), { timeout: 20000, interval: 250 })
      .toBe(false);
  });

  it("still writes the state vector back for a page that exists", async () => {
    const pageId = await makePage("Kept");
    const { doc, provider } = await open(pageId);
    doc.getXmlFragment("default").push([new Y.XmlElement("paragraph")]);

    await expect
      .poll(
        async () =>
          (await prisma.page.findUnique({ where: { id: pageId }, select: { ydocS3Key: true } }))
            ?.ydocS3Key,
        { timeout: 15000, interval: 500 },
      )
      .toBe(`ydoc/${pageId}`);
    provider.destroy();
  });
});
