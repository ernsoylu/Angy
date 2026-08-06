import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { SignJWT } from "jose";
import * as Y from "yjs";
import { getPrisma } from "@angy/db";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";
import { getObject } from "../src/s3.js";

/**
 * The required CRDT convergence test (CLAUDE.md § Testing): two clients edit
 * the same page, one of them offline, reconnect, and both must converge.
 * Runs against the real docker stack (postgres + redis + minio).
 */

const PORT = 3979;
const URL = `ws://127.0.0.1:${PORT}`;
const prisma = getPrisma();

let server: ReturnType<typeof buildServer>;
let pageId: string;
let spaceId: bigint;
let userId: bigint;

async function mintToken(page: string, name: string): Promise<string> {
  return new SignJWT({ page, name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId.toString())
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(env.jwtSecret()));
}

function connect(doc: Y.Doc, token: string): HocuspocusProvider {
  return new HocuspocusProvider({ url: URL, name: pageId, document: doc, token });
}

function waitForSync(provider: HocuspocusProvider, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (provider.synced) return resolve();
    const timer = setTimeout(() => reject(new Error("sync timeout")), timeoutMs);
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function paragraph(text: string): Y.XmlElement {
  const el = new Y.XmlElement("paragraph");
  el.insert(0, [new Y.XmlText(text)]);
  return el;
}

function docText(doc: Y.Doc): string {
  return doc.getXmlFragment("default").toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const user = await prisma.appUser.upsert({
    where: { oidcSubject: "test|convergence" },
    update: {},
    create: {
      oidcSubject: "test|convergence",
      email: "convergence@test.io",
      displayName: "Convergence Tester",
    },
  });
  userId = user.id;
  const space = await prisma.space.upsert({
    where: { key: "convergence-test" },
    update: {},
    create: { key: "convergence-test", name: "Convergence Test" },
  });
  spaceId = space.id;
  // Editors must hold EDIT — the realtime server enforces it in onAuthenticate.
  await prisma.spaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId } },
    update: { permLevel: "EDIT" },
    create: { spaceId, userId, permLevel: "EDIT" },
  });
  const page = await prisma.page.create({
    data: {
      spaceId,
      title: "Convergence",
      slug: `convergence-${Date.now()}`,
      createdBy: userId,
      documentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "seed" }] }],
      },
    },
  });
  pageId = page.id;
  server = buildServer(PORT);
  await server.listen();
});

afterAll(async () => {
  await server.destroy();
  await prisma.page.deleteMany({ where: { spaceId } });
  await prisma.$disconnect();
});

describe("CRDT convergence", () => {
  it("rejects connections without a valid token", async () => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: URL,
      name: pageId,
      document: doc,
      token: "not-a-token",
    });
    const failed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      provider.on("authenticationFailed", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    provider.destroy();
    expect(failed).toBe(true);
  });

  it("bootstraps the doc from document_json exactly once and serves persisted bytes", async () => {
    const doc = new Y.Doc();
    const provider = connect(doc, await mintToken(pageId, "A"));
    await waitForSync(provider);
    expect(docText(doc)).toContain("seed");
    provider.destroy();

    const page = await prisma.page.findUnique({ where: { id: pageId } });
    expect(page?.ydocS3Key).toBe(`ydoc/${pageId}`);
    expect(await getObject(page!.ydocS3Key!)).not.toBeNull();
  });

  it("converges after concurrent offline edits from two clients", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const providerA = connect(docA, await mintToken(pageId, "A"));
    const providerB = connect(docB, await mintToken(pageId, "B"));
    await Promise.all([waitForSync(providerA), waitForSync(providerB)]);

    // B goes offline; both sides edit concurrently.
    providerB.disconnect();
    await sleep(200);
    docA.getXmlFragment("default").push([paragraph("edit from A while B offline")]);
    docB.getXmlFragment("default").push([paragraph("offline edit from B")]);
    await sleep(300);
    expect(docText(docA)).not.toContain("offline edit from B");

    // B reconnects — both docs must converge to the same state.
    providerB.connect();
    await waitForSync(providerB);
    await sleep(1000);

    for (const doc of [docA, docB]) {
      expect(docText(doc)).toContain("edit from A while B offline");
      expect(docText(doc)).toContain("offline edit from B");
    }
    expect(docText(docA)).toBe(docText(docB));
    expect(Y.encodeStateVector(docA)).toEqual(Y.encodeStateVector(docB));

    providerA.destroy();
    providerB.destroy();
  });

  it("persists the converged doc to S3 after the store debounce", async () => {
    await sleep(3000); // server debounce is 2s
    const bytes = await getObject(`ydoc/${pageId}`);
    expect(bytes).not.toBeNull();
    const check = new Y.Doc();
    Y.applyUpdate(check, bytes!);
    const text = docText(check);
    expect(text).toContain("edit from A while B offline");
    expect(text).toContain("offline edit from B");
  });
});
