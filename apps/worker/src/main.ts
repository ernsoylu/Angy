import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  DOC_COMMAND_CHANNEL,
  JOB_ATTACHMENT_REINDEX,
  JOB_COMPACT_PAGE,
  JOB_GC_PAGE,
  JOB_MEDIA_REEMIT,
  JOB_PROJECTION_INIT,
  JOB_PROJECTION_REBUILD,
  JOB_REVISION_CHECKPOINT,
  JOB_SEARCH_REINDEX,
  JOB_SPACE_REINDEX,
  JOB_THUMBNAIL,
  QUEUE_MAINTENANCE,
  QUEUE_PROJECTIONS,
  type AttachmentReindexJobData,
  type CompactPageJobData,
  type GcPageJobData,
  type MediaReemitJobData,
  type ProjectionJobData,
  type RelabelCommand,
  type RevisionCheckpointJobData,
  type SearchReindexJobData,
  type SpaceReindexJobData,
  type ThumbnailJobData,
} from "@angy/shared";
import { env } from "./env.js";
import {
  findStalePageIds,
  initYdoc,
  rebuildProjection,
  type ReferrerRefresh,
} from "./projection.js";
import { compactPage, findCompactionCandidates, writeRevisionCheckpoint } from "./revisions.js";

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
/** Separate from the BullMQ connection: publishing shares nothing with queueing. */
const docCommands = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });

const RECONCILE_JOB = "reconcile";
const RECONCILE_EVERY_MS = 5 * 60 * 1000;
const COMPACTION_SCAN_JOB = "compaction-scan";
const COMPACTION_EVERY_MS = Number(process.env.COMPACTION_EVERY_MS ?? 6 * 60 * 60 * 1000);
const GC_SCAN_JOB = "gc-scan";
const GC_EVERY_MS = Number(process.env.GC_EVERY_MS ?? 6 * 60 * 60 * 1000);

const queue = new Queue(QUEUE_PROJECTIONS, { connection });
const maintenance = new Queue(QUEUE_MAINTENANCE, { connection });

/**
 * Alert signals (docs/runbooks/alerts.md): `[alert]` log lines are the V1
 * alerting interface — the log pipeline pages on them. Redis memory matters
 * because the Y.Doc hot cache runs noeviction: filling up means writes fail.
 */
let lastStaleCount = 0;

async function emitHealthSignals(staleCount: number): Promise<void> {
  if (staleCount > 0 && lastStaleCount > 0) {
    console.warn(
      `[alert] projections stale across consecutive reconcile passes (${staleCount} page(s)) — worker may be wedged`,
    );
  }
  lastStaleCount = staleCount;

  const info = await connection.info("memory");
  const used = Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0);
  const max = Number(/maxmemory:(\d+)/.exec(info)?.[1] ?? 0);
  if (max > 0 && used / max > 0.8) {
    console.warn(
      `[alert] redis memory at ${Math.round((used / max) * 100)}% of maxmemory — noeviction hot cache will start failing writes`,
    );
  }
}

/**
 * Catch up everything showing a link label a rename just invalidated (V2 H1).
 *
 * Two audiences, two mechanisms. **Readers** are served `rendered_html`, so
 * their referring pages are re-projected — the job id dedupes only while one is
 * still pending, `removeOnComplete` clearing it so a later rename enqueues
 * again instead of being silently swallowed. **Live editors** render from the
 * Y.Doc, which the projection never touches, so realtime is told the page was
 * renamed and rewrites the label in whichever documents are open.
 *
 * The command names the target, not the referrers: realtime intersects it with
 * its open set, so a hub page's rename costs one message instead of one Y.Doc
 * load per referring document. Documents that are closed are repaired when
 * they are next loaded.
 *
 * Nothing cascades: a referrer's own rebuild only returns work if *its* title
 * is what drifted.
 */
async function refreshReferrers(refresh: ReferrerRefresh | null): Promise<void> {
  if (!refresh || refresh.pageIds.length === 0) return;
  console.log(`[worker] refreshing ${refresh.pageIds.length} page(s) linking to a renamed page`);
  await queue.addBulk(
    refresh.pageIds.map((pageId) => ({
      name: JOB_PROJECTION_REBUILD,
      data: { pageId },
      opts: { jobId: `relabel-${pageId}`, removeOnComplete: true, removeOnFail: true },
    })),
  );
  const command: RelabelCommand = {
    type: "relabel",
    targetPageId: refresh.targetPageId,
    title: refresh.title,
  };
  await docCommands.publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));
}

const worker = new Worker<ProjectionJobData | Record<string, never>>(
  QUEUE_PROJECTIONS,
  async (job) => {
    if (job.name === JOB_PROJECTION_INIT) {
      await refreshReferrers(await initYdoc((job.data as ProjectionJobData).pageId));
    } else if (job.name === JOB_PROJECTION_REBUILD) {
      await refreshReferrers(await rebuildProjection((job.data as ProjectionJobData).pageId));
    } else if (job.name === JOB_SEARCH_REINDEX) {
      // Tag edits change what search knows, not what the page says — no need
      // to re-render the Y.Doc.
      const { indexPage } = await import("./search.js");
      await indexPage((job.data as SearchReindexJobData).pageId);
    } else if (job.name === RECONCILE_JOB) {
      const stale = await findStalePageIds();
      if (stale.length > 0) {
        console.log(`[worker] reconcile: ${stale.length} stale projection(s)`);
        await queue.addBulk(
          stale.map((pageId) => ({
            name: JOB_PROJECTION_REBUILD,
            data: { pageId },
            // The jobId coalesces repeat sweeps while a rebuild is still
            // pending — but BullMQ keeps completed jobs by default, and a
            // retained id makes every later add for that page a *silent*
            // no-op. Without these the reconciler repairs a given page once
            // and never again: the sweep keeps reporting it stale, keeps
            // enqueuing nothing, and eventually alerts that the worker is
            // wedged when the worker is fine. Found live with six pages stale
            // since the day their ids were first enqueued.
            opts: { jobId: `rebuild-${pageId}`, removeOnComplete: true, removeOnFail: true },
          })),
        );
      }
      await emitHealthSignals(stale.length);
    }
  },
  { connection, concurrency: 4 },
);

worker.on("ready", async () => {
  console.log("[worker] projections queue ready");
  const { ensureAttachmentIndex, ensureSearchIndex, indexAllAttachments, indexAllPages } =
    await import("./search.js");
  await ensureSearchIndex();
  await ensureAttachmentIndex();
  const indexed = await indexAllPages();
  const attachments = await indexAllAttachments();
  console.log(
    `[worker] search indexes ready (${indexed} page(s), ${attachments} attachment(s) backfilled)`,
  );
  const { ensurePublicMediaPolicy } = await import("./thumbnails.js");
  await ensurePublicMediaPolicy();
  console.log("[worker] public media bucket policy ensured");
  await queue.upsertJobScheduler(RECONCILE_JOB, { every: RECONCILE_EVERY_MS }, {
    name: RECONCILE_JOB,
  });
  await maintenance.upsertJobScheduler(COMPACTION_SCAN_JOB, { every: COMPACTION_EVERY_MS }, {
    name: COMPACTION_SCAN_JOB,
  });
  await maintenance.upsertJobScheduler(GC_SCAN_JOB, { every: GC_EVERY_MS }, {
    name: GC_SCAN_JOB,
  });
});

worker.on("completed", (job) => {
  if (job.name !== RECONCILE_JOB) console.log(`[worker] ${job.name} done (${job.id})`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] ${job?.name} failed (${job?.id}):`, err.message);
});

/** Maintenance: revision checkpoints + compaction. Bounded concurrency (runbook). */
const maintenanceWorker = new Worker(
  QUEUE_MAINTENANCE,
  async (job) => {
    if (job.name === JOB_SPACE_REINDEX) {
      const { indexSpace } = await import("./search.js");
      const count = await indexSpace(BigInt((job.data as SpaceReindexJobData).spaceId));
      console.log(`[worker] reindexed ${count} page(s) after a space state change`);
    } else if (job.name === JOB_ATTACHMENT_REINDEX) {
      const { indexAttachment } = await import("./search.js");
      await indexAttachment(BigInt((job.data as AttachmentReindexJobData).attachmentId));
    } else if (job.name === JOB_REVISION_CHECKPOINT) {
      const data = job.data as RevisionCheckpointJobData;
      let author = data.createdBy ? BigInt(data.createdBy) : null;
      if (author === null) {
        const { getPrisma } = await import("@angy/db");
        const page = await getPrisma().page.findUnique({ where: { id: data.pageId } });
        if (!page) return;
        author = page.updatedBy ?? page.createdBy;
      }
      await writeRevisionCheckpoint(data.pageId, author, data.label ?? null);
      await refreshReferrers(await rebuildProjection(data.pageId));
    } else if (job.name === JOB_COMPACT_PAGE) {
      await compactPage((job.data as CompactPageJobData).pageId);
    } else if (job.name === JOB_THUMBNAIL) {
      const { generateThumbnail } = await import("./thumbnails.js");
      await generateThumbnail(BigInt((job.data as ThumbnailJobData).attachmentId));
    } else if (job.name === JOB_GC_PAGE) {
      const { hardDeletePage } = await import("./gc.js");
      await hardDeletePage((job.data as GcPageJobData).pageId);
    } else if (job.name === JOB_MEDIA_REEMIT) {
      const { reemitMediaForPage } = await import("./media-reemit.js");
      await reemitMediaForPage((job.data as MediaReemitJobData).pageId);
    } else if (job.name === GC_SCAN_JOB) {
      const { gcTrash } = await import("./gc.js");
      const swept = await gcTrash();
      if (swept.spaces || swept.pages || swept.attachments || swept.revisions || swept.tags) {
        console.log(
          `[worker] gc: ${swept.spaces} space(s), ${swept.pages} page(s), ${swept.attachments} attachment(s), ${swept.revisions} thinned revision(s), ${swept.tags} unused tag(s)`,
        );
      }
    } else if (job.name === COMPACTION_SCAN_JOB) {
      const candidates = await findCompactionCandidates();
      if (candidates.length > 0) {
        console.log(`[worker] compaction scan: ${candidates.length} candidate(s)`);
        await maintenance.addBulk(
          candidates.map((pageId) => ({
            name: JOB_COMPACT_PAGE,
            data: { pageId },
            opts: { jobId: `compact-${pageId}-${job.id}` },
          })),
        );
      }
    }
  },
  { connection, concurrency: 2 },
);

// Compaction runbook: alert when the same doc fails repeatedly — likely a
// corrupt update log. Escalate; never force-swap.
const COMPACT_FAIL_ALERT_AT = 3;
const compactFailKey = (pageId: string) => `compactfail:${pageId}`;

maintenanceWorker.on("failed", (job, err) => {
  console.error(`[worker] ${job?.name} failed (${job?.id}):`, err.message);
  if (job?.name === JOB_COMPACT_PAGE) {
    const pageId = (job.data as CompactPageJobData).pageId;
    void connection
      .incr(compactFailKey(pageId))
      .then(async (count) => {
        await connection.expire(compactFailKey(pageId), 24 * 60 * 60);
        if (count >= COMPACT_FAIL_ALERT_AT) {
          console.warn(
            `[alert] compaction failed ${count}× consecutively for ${pageId} — possible corrupt update log, do not force-swap`,
          );
        }
      })
      .catch(() => undefined);
  }
});

maintenanceWorker.on("completed", (job) => {
  if (job.name === JOB_COMPACT_PAGE) {
    void connection.del(compactFailKey((job.data as CompactPageJobData).pageId));
  }
});
