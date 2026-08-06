import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  JOB_COMPACT_PAGE,
  JOB_GC_PAGE,
  JOB_MEDIA_REEMIT,
  JOB_PROJECTION_INIT,
  JOB_PROJECTION_REBUILD,
  JOB_REVISION_CHECKPOINT,
  JOB_THUMBNAIL,
  QUEUE_MAINTENANCE,
  QUEUE_PROJECTIONS,
  type CompactPageJobData,
  type GcPageJobData,
  type MediaReemitJobData,
  type ProjectionJobData,
  type RevisionCheckpointJobData,
  type ThumbnailJobData,
} from "@angy/shared";
import { env } from "./env.js";
import { findStalePageIds, initYdoc, rebuildProjection } from "./projection.js";
import { compactPage, findCompactionCandidates, writeRevisionCheckpoint } from "./revisions.js";

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

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

const worker = new Worker<ProjectionJobData | Record<string, never>>(
  QUEUE_PROJECTIONS,
  async (job) => {
    if (job.name === JOB_PROJECTION_INIT) {
      await initYdoc((job.data as ProjectionJobData).pageId);
    } else if (job.name === JOB_PROJECTION_REBUILD) {
      await rebuildProjection((job.data as ProjectionJobData).pageId);
    } else if (job.name === RECONCILE_JOB) {
      const stale = await findStalePageIds();
      if (stale.length > 0) {
        console.log(`[worker] reconcile: ${stale.length} stale projection(s)`);
        await queue.addBulk(
          stale.map((pageId) => ({
            name: JOB_PROJECTION_REBUILD,
            data: { pageId },
            opts: { jobId: `rebuild-${pageId}` },
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
  const { ensureSearchIndex, indexAllPages } = await import("./search.js");
  await ensureSearchIndex();
  const indexed = await indexAllPages();
  console.log(`[worker] search index ready (${indexed} pages backfilled)`);
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
    if (job.name === JOB_REVISION_CHECKPOINT) {
      const data = job.data as RevisionCheckpointJobData;
      let author = data.createdBy ? BigInt(data.createdBy) : null;
      if (author === null) {
        const { getPrisma } = await import("@angy/db");
        const page = await getPrisma().page.findUnique({ where: { id: data.pageId } });
        if (!page) return;
        author = page.updatedBy ?? page.createdBy;
      }
      await writeRevisionCheckpoint(data.pageId, author, data.label ?? null);
      await rebuildProjection(data.pageId);
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
      if (swept.pages || swept.attachments) {
        console.log(`[worker] gc: ${swept.pages} page(s), ${swept.attachments} attachment(s)`);
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

maintenanceWorker.on("failed", (job, err) => {
  console.error(`[worker] ${job?.name} failed (${job?.id}):`, err.message);
});
