/** BullMQ queue and job names shared between apps/api (producers) and apps/worker. */
export const QUEUE_PROJECTIONS = "projections";

export const JOB_PROJECTION_INIT = "init";
export const JOB_PROJECTION_REBUILD = "rebuild";

export interface ProjectionJobData {
  pageId: string;
}

/** Maintenance queue: revision checkpoints + compaction (bounded concurrency). */
export const QUEUE_MAINTENANCE = "maintenance";

export const JOB_REVISION_CHECKPOINT = "revision-checkpoint";
export const JOB_COMPACT_PAGE = "compact-page";

export interface RevisionCheckpointJobData {
  pageId: string;
  /**
   * Author of the checkpoint, as a decimal string (BigInt is not JSON-safe).
   * Omitted for automatic checkpoints (idle cutoff) — the worker falls back
   * to the page's last editor.
   */
  createdBy?: string;
  label?: string | null;
}

export interface CompactPageJobData {
  pageId: string;
}

export const JOB_THUMBNAIL = "thumbnail";

export interface ThumbnailJobData {
  attachmentId: string;
}

/** Hard-delete a single page immediately ("Delete now" / empty trash). */
export const JOB_GC_PAGE = "gc-page";

export interface GcPageJobData {
  pageId: string;
}

/** Redis pub/sub channel for document commands (restore) consumed by realtime. */
export const DOC_COMMAND_CHANNEL = "doc-command";

export interface RestoreCommand {
  type: "restore";
  pageId: string;
  version: number;
  /** User performing the restore, decimal string. */
  userId: string;
}
