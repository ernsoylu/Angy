import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Redis } from "ioredis";
import { SignJWT } from "jose";
import * as Y from "yjs";
import { getPrisma } from "@angy/db";
import { env } from "../src/env.js";
import { buildServer, PERM_CHANGED_CHANNEL } from "../src/server.js";
import { ORDER_KEY_START } from "@angy/shared";

/**
 * Live revocation (ADR 0008): an editor whose rights are removed mid-session
 * must be disconnected when the perm-changed event fires — bitmap
 * invalidation alone only gates new checks.
 */

const PORT = 3981;
const prisma = getPrisma();
const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });

let server: ReturnType<typeof buildServer>;
let pageId: string;
let spaceId: bigint;
let outsiderId: bigint;

beforeAll(async () => {
  const outsider = await prisma.appUser.upsert({
    where: { oidcSubject: "test|revocation" },
    update: {},
    create: {
      oidcSubject: "test|revocation",
      email: "revocation@test.io",
      displayName: "Revocation Tester",
    },
  });
  outsiderId = outsider.id;
  // Private space the outsider is NOT a member of — access comes only from a page grant.
  const space = await prisma.space.upsert({
    where: { key: "revocation-test" },
    update: {},
    create: { key: "revocation-test", name: "Revocation Test", visibility: "PRIVATE" },
  });
  spaceId = space.id;
  const page = await prisma.page.create({
    data: {
      spaceId,
      title: "Revocable",
      slug: `revocable-${Date.now()}`,
      // Fixtures write the row directly, so the sibling key comes from here.
      ord: ORDER_KEY_START,
      createdBy: outsiderId,
      documentJson: { type: "doc", content: [{ type: "paragraph" }] },
    },
  });
  pageId = page.id;
  await prisma.pagePermission.create({
    data: { pageId, userId: outsiderId, permLevel: "EDIT", grantedBy: outsiderId },
  });
  server = buildServer(PORT);
  await server.listen();
});

afterAll(async () => {
  await server.destroy();
  await prisma.page.deleteMany({ where: { spaceId } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("live revocation", () => {
  it("disconnects an editor whose grant is removed mid-session", async () => {
    const token = await new SignJWT({ page: pageId, name: "Revocation Tester" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(outsiderId.toString())
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(env.jwtSecret()));

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${PORT}`,
      name: pageId,
      document: doc,
      token,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connect timeout")), 10000);
      provider.on("synced", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const disconnected = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      provider.on("close", done);
      provider.on("status", ({ status }: { status: string }) => {
        if (status === "disconnected") done();
      });
    });

    // Revoke the grant, then fire the same event the API publishes.
    await prisma.pagePermission.deleteMany({ where: { pageId, userId: outsiderId } });
    await redis.publish(PERM_CHANGED_CHANNEL, JSON.stringify({ pageIds: [pageId] }));

    expect(await disconnected).toBe(true);
    provider.destroy();
  });

  /**
   * Wave E: membership and the space baseline reach every page at once, so the
   * API publishes the *space*, not a page list. The realtime tier has to
   * resolve that against whatever is currently open.
   */
  it("disconnects an editor when the event names only the space", async () => {
    // Access this time comes from membership, which is what a space-wide
    // change removes.
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId: outsiderId } },
      update: { permLevel: "EDIT" },
      create: { spaceId, userId: outsiderId, permLevel: "EDIT" },
    });
    const page = await prisma.page.create({
      data: {
        spaceId,
        title: "Space-wide",
        slug: `space-wide-${Date.now()}`,
        // Fixtures write the row directly, so the sibling key comes from here.
        ord: ORDER_KEY_START,
        createdBy: outsiderId,
        documentJson: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });

    const token = await new SignJWT({ page: page.id, name: "Revocation Tester" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(outsiderId.toString())
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(env.jwtSecret()));

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${PORT}`,
      name: page.id,
      document: doc,
      token,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connect timeout")), 10000);
      provider.on("synced", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const disconnected = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      provider.on("close", done);
      provider.on("status", ({ status }: { status: string }) => {
        if (status === "disconnected") done();
      });
    });

    await prisma.spaceMember.deleteMany({ where: { spaceId, userId: outsiderId } });
    await redis.publish(
      PERM_CHANGED_CHANNEL,
      JSON.stringify({ spaceId: spaceId.toString() }),
    );

    expect(await disconnected).toBe(true);
    provider.destroy();
  });
});
