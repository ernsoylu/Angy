import { Server } from "@hocuspocus/server";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import * as Y from "yjs";
import { applyDocJson, createYdocFromJson, ydocToJson, type JSONContent } from "@angy/blocks";
import { getEffectivePageLevel, getPrisma } from "@angy/db";
import {
  DOC_COMMAND_CHANNEL,
  JOB_PROJECTION_REBUILD,
  JOB_REVISION_CHECKPOINT,
  QUEUE_MAINTENANCE,
  QUEUE_PROJECTIONS,
  satisfies,
  type RestoreCommand,
} from "@angy/shared";
import { env } from "./env.js";
import { getObject, putObject } from "./s3.js";
import { verifyRealtimeToken } from "./token.js";

/** Published by the API on every permission change (ADR 0004 / 0008). */
export const PERM_CHANGED_CHANNEL = "perm-changed";

interface ConnectionContext {
  userId: string;
  name: string;
}

/** Y.Doc hot cache TTL — the doc lives in Redis while it is being edited. */
const HOT_TTL_SECONDS = 30 * 60;
const hotKey = (pageId: string) => `ydoc:hot:${pageId}`;
const ydocS3Key = (pageId: string) => `ydoc/${pageId}`;

/**
 * Load exactly the persisted Y.Doc update bytes (CLAUDE.md gotcha: NEVER
 * rebuild a doc from document_json/HTML once one exists — clients would fork).
 * The one exception is a page whose Y.Doc has never been created: it is
 * bootstrapped once from document_json via the shared @angy/blocks helper
 * (the same code path the worker's init job uses), then persisted.
 */
async function loadPersistedUpdate(redis: Redis, pageId: string): Promise<Uint8Array> {
  const hot = await redis.getBuffer(hotKey(pageId));
  if (hot) return new Uint8Array(hot);

  const prisma = getPrisma();
  const page = await prisma.page.findFirst({ where: { id: pageId, deletedAt: null } });
  if (!page) throw new Error(`Unknown document ${pageId}`);

  if (page.ydocS3Key) {
    const bytes = await getObject(page.ydocS3Key);
    if (bytes) return bytes;
  }

  const ydoc = createYdocFromJson(page.documentJson as JSONContent | null);
  const update = Y.encodeStateAsUpdate(ydoc);
  await putObject(ydocS3Key(pageId), update);
  await prisma.page.update({
    where: { id: pageId },
    data: {
      ydocS3Key: ydocS3Key(pageId),
      ydocStateVector: Buffer.from(Y.encodeStateVector(ydoc)),
    },
  });
  ydoc.destroy();
  return update;
}

/**
 * Live revocation (ADR 0008): when permissions change, re-check every open
 * connection on the affected pages and disconnect editors who lost rights.
 * The bitmap invalidation alone only gates NEW checks — this reaches live
 * sessions.
 */
function subscribeToPermChanges(server: Server, subscriber: Redis): void {
  void subscriber.subscribe(PERM_CHANGED_CHANNEL);
  subscriber.on("message", (channel, message) => {
    if (channel !== PERM_CHANGED_CHANNEL) return;
    void (async () => {
      const { pageIds } = JSON.parse(message) as { pageIds: string[] };
      for (const pageId of pageIds) {
        const document = server.hocuspocus.documents.get(pageId);
        if (!document) continue;
        for (const connection of document.connections.keys()) {
          const context = connection.context as ConnectionContext | undefined;
          if (!context || !/^\d+$/.test(context.userId)) continue;
          const level = await getEffectivePageLevel(
            getPrisma(),
            BigInt(context.userId),
            pageId,
          );
          if (!satisfies(level, "EDIT")) {
            console.log(
              `[realtime] revoking ${context.name} on ${pageId} (now ${level ?? "none"})`,
            );
            connection.close({ code: 4403, reason: "permission-revoked" });
          }
        }
      }
    })();
  });
}

/**
 * Restore commands (ADR 0006): apply the old revision's content to the live
 * doc as a normal forward update via a server-side direct connection — open
 * editors converge on it like any other edit; history is never rewritten.
 */
function subscribeToDocCommands(
  server: Server,
  subscriber: Redis,
  maintenance: Queue,
): void {
  void subscriber.subscribe(DOC_COMMAND_CHANNEL);
  subscriber.on("message", (channel, message) => {
    if (channel !== DOC_COMMAND_CHANNEL) return;
    void (async () => {
      const command = JSON.parse(message) as RestoreCommand;
      if (command.type !== "restore") return;
      const revision = await getPrisma().pageRevision.findUnique({
        where: { pageId_version: { pageId: command.pageId, version: command.version } },
      });
      if (!revision) return;
      const bytes = await getObject(revision.revisionS3Key);
      if (!bytes) return;
      const revisionDoc = new Y.Doc();
      Y.applyUpdate(revisionDoc, bytes);
      const json = ydocToJson(revisionDoc);
      revisionDoc.destroy();

      const connection = await server.hocuspocus.openDirectConnection(command.pageId, {
        userId: command.userId,
        name: "restore",
      });
      try {
        await connection.transact((document) => applyDocJson(document, json));
      } finally {
        await connection.disconnect();
      }
      // The store debounce persists the applied state ~2s later; the labelled
      // checkpoint job reads it after that window.
      await maintenance.add(
        JOB_REVISION_CHECKPOINT,
        {
          pageId: command.pageId,
          createdBy: command.userId,
          label: `restore of v${command.version}`,
        },
        { delay: 4000 },
      );
      console.log(`[realtime] restored ${command.pageId} to v${command.version}`);
    })();
  });
}

export function buildServer(port = env.port): Server {
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  const bullConnection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  const projections = new Queue(QUEUE_PROJECTIONS, { connection: bullConnection });
  const maintenance = new Queue(QUEUE_MAINTENANCE, { connection: bullConnection });

  const server: Server = new Server({
    port,
    // Persist ~2s after the last change; data-loss window == this debounce.
    debounce: 2000,
    maxDebounce: 10000,
    quiet: true,
    // Yjs GC stays ON — always (hard rule 7). This is also the default.
    yDocOptions: { gc: true, gcFilter: () => true },

    async onAuthenticate({ token, documentName }): Promise<ConnectionContext> {
      const claims = await verifyRealtimeToken(token);
      if (claims.pageId !== documentName) {
        throw new Error("Token does not grant access to this document");
      }
      // Authz (ADR 0008): only editors connect — readers consume SSR HTML.
      const level = await getEffectivePageLevel(
        getPrisma(),
        BigInt(claims.userId),
        documentName,
      );
      if (!satisfies(level, "EDIT")) {
        throw new Error("Edit access required");
      }
      return { userId: claims.userId, name: claims.name };
    },

    async onLoadDocument({ document, documentName }) {
      const bytes = await loadPersistedUpdate(redis, documentName);
      Y.applyUpdate(document, bytes);
      return document;
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const update = Y.encodeStateAsUpdate(document);
      const stateVector = Y.encodeStateVector(document);
      const editor = (lastContext ?? undefined) as ConnectionContext | undefined;

      await Promise.all([
        redis.set(hotKey(documentName), Buffer.from(update), "EX", HOT_TTL_SECONDS),
        putObject(ydocS3Key(documentName), update),
      ]);
      await getPrisma().page.update({
        where: { id: documentName },
        data: {
          ydocS3Key: ydocS3Key(documentName),
          ydocStateVector: Buffer.from(stateVector),
          ...(editor && /^\d+$/.test(editor.userId) && { updatedBy: BigInt(editor.userId) }),
        },
      });
      // Live-by-default (ADR 0010): readers see this once the projection rebuilds.
      await projections.add(JOB_PROJECTION_REBUILD, { pageId: documentName });
    },

    async onDisconnect({ documentName, clientsCount }) {
      console.log(`[realtime] disconnect on ${documentName}, ${clientsCount} client(s) left`);
    },

    // Idle cutoff (ADR 0006): when the last editor leaves, checkpoint a revision.
    async afterUnloadDocument({ documentName }) {
      try {
        console.log(`[realtime] unload ${documentName} -> checkpoint queued`);
        await maintenance.add(JOB_REVISION_CHECKPOINT, { pageId: documentName }, { delay: 3000 });
      } catch (err) {
        console.error(`[realtime] checkpoint enqueue failed for ${documentName}:`, err);
      }
    },
  });

  subscribeToPermChanges(server, new Redis(env.redisUrl, { maxRetriesPerRequest: 2 }));
  subscribeToDocCommands(server, new Redis(env.redisUrl, { maxRetriesPerRequest: 2 }), maintenance);
  return server;
}
