import { Server } from "@hocuspocus/server";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import * as Y from "yjs";
import {
  applyDocJson,
  applyTextDiff,
  createYdocFromJson,
  referenceTargets,
  relabelReferences,
  TITLE_FIELD,
  ydocTitle,
  ydocToJson,
  type JSONContent,
} from "@angy/blocks";
import { getEffectivePageLevel, getPrisma } from "@angy/db";
import {
  DOC_COMMAND_CHANNEL,
  JOB_COMPACT_PAGE,
  JOB_PROJECTION_REBUILD,
  JOB_REVISION_CHECKPOINT,
  QUEUE_MAINTENANCE,
  QUEUE_PROJECTIONS,
  REVOKED_CLOSE_REASON,
  satisfies,
  type DocCommand,
  type RelabelCommand,
  type RenameCommand,
  type RewriteMediaCommand,
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

/** Size-triggered compaction (runbook): enqueue as soon as a blob crosses this. */
const COMPACTION_SIZE_THRESHOLD_BYTES = Number(
  process.env.COMPACTION_SIZE_THRESHOLD_BYTES ?? 2 * 1024 * 1024,
);
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
 * Seed the collaborative title from `page.title` for any doc that predates the
 * field — the one-time migration path. An emptied title reseeds the same way,
 * which is what keeps a page from ending up nameless.
 */
async function bootstrapTitle(document: Y.Doc, pageId: string): Promise<void> {
  if (ydocTitle(document) !== "") return;
  const page = await getPrisma().page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { title: true },
  });
  if (page?.title) document.getText(TITLE_FIELD).insert(0, page.title);
}

/**
 * Point this document's cached labels — page-link titles and mention names —
 * at their targets' current values.
 *
 * The label is authored into the node when the reference is made and cannot
 * follow a later rename on its own. Readers never see the stale one, because
 * the projection resolves labels on the way to rendered_html; the editor
 * renders from the Y.Doc, so it does. Repairing on load is what makes that
 * self-healing without a fan-out: every document is fixed the moment somebody
 * opens it, and one nobody opens is one nobody sees a stale label in.
 *
 * Cheap in the common case: no references means one CRDT walk and no query,
 * and a document whose labels are already right produces no Yjs update at all,
 * so it is not re-stored or checkpointed for having been opened.
 */
async function repairReferenceLabels(document: Y.Doc, pageId: string): Promise<void> {
  const { pageIds, userIds } = referenceTargets(document);
  if (pageIds.length === 0 && userIds.length === 0) return;
  const prisma = getPrisma();
  const [pages, users] = await Promise.all([
    pageIds.length === 0
      ? []
      : prisma.page.findMany({
          where: { id: { in: pageIds }, deletedAt: null },
          select: { id: true, title: true },
        }),
    userIds.length === 0
      ? []
      : prisma.appUser.findMany({
          where: { id: { in: userIds.map((id) => BigInt(id)) } },
          select: { id: true, displayName: true },
        }),
  ]);
  const changed = relabelReferences(document, {
    pages: new Map(pages.map((p) => [p.id, p.title])),
    users: new Map(users.map((u) => [u.id.toString(), u.displayName])),
  });
  if (changed > 0) {
    console.log(`[realtime] relabelled ${changed} reference(s) on load of ${pageId}`);
  }
}

/**
 * A page was renamed: fix the label in every *open* document linking to it, so
 * people editing right now see the new name without reopening.
 *
 * Resolved against the open set rather than against a list of referrers, the
 * same way space-scoped permission events are (ADR 0008). A hub page can be
 * linked from thousands of documents; loading each one to rewrite an attribute
 * would turn a rename into a storm of S3 reads, revision checkpoints and
 * projection rebuilds. Closed documents cost nothing and lose nothing — they
 * are repaired on their next load.
 */
async function relabelOpenDocuments(server: Server, command: RelabelCommand): Promise<void> {
  const names = {
    pages: new Map([[command.targetPageId, command.title]]),
    users: new Map<string, string>(),
  };
  for (const name of [...server.hocuspocus.documents.keys()]) {
    const document = server.hocuspocus.documents.get(name);
    if (!document || !referenceTargets(document).pageIds.includes(command.targetPageId)) continue;
    // Through a direct connection, so the edit stores and broadcasts like any
    // other rather than mutating a shared document behind Hocuspocus's back.
    const connection = await server.hocuspocus.openDirectConnection(name, { name: "relabel" });
    try {
      await connection.transact((doc) => {
        const changed = relabelReferences(doc, names);
        if (changed > 0) console.log(`[realtime] relabelled ${changed} link(s) in open ${name}`);
      });
    } finally {
      await connection.disconnect();
    }
  }
}

/**
 * Rename through the doc (Wave F). REST renames land here rather than writing
 * `page.title`, so the row and the doc can never disagree — `onStoreDocument`
 * copies the title back out once the edit persists.
 */
async function renameDocument(server: Server, command: RenameCommand): Promise<void> {
  const connection = await server.hocuspocus.openDirectConnection(command.pageId, {
    userId: command.userId,
    name: "rename",
  });
  try {
    await connection.transact((document) => {
      applyTextDiff(document.getText(TITLE_FIELD), command.title);
    });
  } finally {
    await connection.disconnect();
  }
  console.log(`[realtime] renamed ${command.pageId} -> ${command.title}`);
}

/**
 * Which currently-open documents a permission change touches.
 *
 * A page-scoped event names its pages outright. A space-scoped one names only
 * the space — a membership change reaches every page in it, and a large space
 * holds far more pages than anyone has open. Resolving it against the open set
 * keeps the work proportional to live sessions instead of to the space.
 */
async function affectedOpenPages(
  server: Server,
  event: { pageIds?: string[]; spaceId?: string },
): Promise<string[]> {
  if (event.pageIds) return event.pageIds;
  if (!event.spaceId) return [];
  const open = [...server.hocuspocus.documents.keys()];
  if (open.length === 0) return [];
  const pages = await getPrisma().page.findMany({
    where: { spaceId: BigInt(event.spaceId), id: { in: open } },
    select: { id: true },
  });
  return pages.map((page) => page.id);
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
      const event = JSON.parse(message) as { pageIds?: string[]; spaceId?: string };
      const pageIds = await affectedOpenPages(server, event);
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
            connection.close({ code: 4403, reason: REVOKED_CLOSE_REASON });
          }
        }
      }
    })();
  });
}

/**
 * Media re-emission (ADR 0007): after the worker moved a page's objects to
 * a new access-class prefix, rewrite embedded image srcs in the live doc.
 * Applied as a normal edit via a direct connection, so open editors converge
 * and the store/projection pipeline republishes the reader HTML.
 */
async function rewriteMedia(server: Server, command: RewriteMediaCommand): Promise<void> {
  const map = new Map(command.mappings.map((m) => [m.from, m.to]));
  const connection = await server.hocuspocus.openDirectConnection(command.pageId, {
    name: "media-reemit",
  });
  try {
    await connection.transact((document) => {
      const walk = (node: Y.XmlFragment | Y.XmlElement): void => {
        for (const child of node.toArray()) {
          if (child instanceof Y.XmlElement) {
            if (child.nodeName === "image") {
              const src = child.getAttribute("src");
              const next = typeof src === "string" ? map.get(src) : undefined;
              if (next) child.setAttribute("src", next);
            }
            walk(child);
          }
        }
      };
      walk(document.getXmlFragment("default"));
    });
  } finally {
    await connection.disconnect();
  }
  console.log(
    `[realtime] rewrote ${command.mappings.length} media src(s) on ${command.pageId}`,
  );
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
      const command = JSON.parse(message) as DocCommand;
      if (command.type === "rewrite-media") {
        await rewriteMedia(server, command);
        return;
      }
      if (command.type === "rename") {
        await renameDocument(server, command);
        return;
      }
      if (command.type === "relabel") {
        await relabelOpenDocuments(server, command);
        return;
      }
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
      await bootstrapTitle(document, documentName);
      // Both of these edit the doc *after* the persisted bytes are applied —
      // never instead of them. Rebuilding a document from anything but its own
      // update log forks every connected client (CLAUDE.md gotcha).
      await repairReferenceLabels(document, documentName);
      return document;
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const update = Y.encodeStateAsUpdate(document);
      const stateVector = Y.encodeStateVector(document);
      const editor = (lastContext ?? undefined) as ConnectionContext | undefined;
      // The doc owns the title (Wave F). An empty one means someone cleared the
      // field mid-edit — keep the last good row value rather than a nameless
      // page; the next load reseeds the doc from it.
      const title = ydocTitle(document).trim();

      await Promise.all([
        redis.set(hotKey(documentName), Buffer.from(update), "EX", HOT_TTL_SECONDS),
        putObject(ydocS3Key(documentName), update),
      ]);
      // updateMany, not update: `update` throws P2025 when the row is gone, and
      // Hocuspocus answers a failed store by keeping the document in memory
      // "to avoid data loss" — so one hard-deleted page pins its doc forever
      // and re-runs the same failing write on every debounce. A page can
      // legitimately disappear under an open socket (trash purge, space
      // purge), and there is nothing to recover for it.
      const stored = await getPrisma().page.updateMany({
        where: { id: documentName },
        data: {
          ydocS3Key: ydocS3Key(documentName),
          ydocStateVector: Buffer.from(stateVector),
          ...(title && { title }),
          ...(editor && /^\d+$/.test(editor.userId) && { updatedBy: BigInt(editor.userId) }),
        },
      });
      if (stored.count === 0) {
        // The S3 blob written above is now an orphan; the object sweep owns it.
        // Nothing downstream is worth queueing for a page nobody can open.
        console.warn(`[realtime] store for ${documentName} matched no page row — skipping`);
        return;
      }
      // Live-by-default (ADR 0010): readers see this once the projection rebuilds.
      await projections.add(JOB_PROJECTION_REBUILD, { pageId: documentName });
      // Size-triggered compaction (runbook) — deduped while one is pending.
      if (update.byteLength > COMPACTION_SIZE_THRESHOLD_BYTES) {
        await maintenance.add(
          JOB_COMPACT_PAGE,
          { pageId: documentName },
          { jobId: `compact-size-${documentName}`, removeOnComplete: true, removeOnFail: true },
        );
      }
    },

    /** Health endpoint for the WS tier (alerts runbook TODO closed). */
    async onRequest({ request, response }) {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            data: { status: "ok", service: "realtime", time: new Date().toISOString() },
          }),
        );
        // Rejecting stops the default handler from also answering.
        return Promise.reject(null);
      }
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
