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

/**
 * Re-index one page without rebuilding its projections. Tag edits change what
 * search knows about a page but nothing about its content, so the expensive
 * Y.Doc → HTML pass would be pure waste.
 */
export const JOB_SEARCH_REINDEX = "search-reindex";

export interface SearchReindexJobData {
  pageId: string;
}

/** Re-index every page in a space — after the space is trashed or restored. */
export const JOB_SPACE_REINDEX = "space-reindex";

export interface SpaceReindexJobData {
  spaceId: string;
}

/** Re-index one attachment after an upload or delete. */
export const JOB_ATTACHMENT_REINDEX = "attachment-reindex";

export interface AttachmentReindexJobData {
  attachmentId: string;
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

/** Redis pub/sub channel for document commands consumed by realtime. */
export const DOC_COMMAND_CHANNEL = "doc-command";

export interface RestoreCommand {
  type: "restore";
  pageId: string;
  version: number;
  /** User performing the restore, decimal string. */
  userId: string;
}

/**
 * Rewrite embedded media srcs after a page crossed a visibility class
 * (ADR 0007): the worker moves the S3 objects, then realtime applies the
 * src mapping to the live doc like any other edit.
 */
export interface RewriteMediaCommand {
  type: "rewrite-media";
  pageId: string;
  mappings: { from: string; to: string }[];
}

/**
 * Rename a page through its Y.Doc. The title is a collaborative field in the
 * same doc as the body, so REST renames cannot write `page.title` directly —
 * the next store would overwrite the row from the doc and the two would fight.
 * The row is updated by `onStoreDocument` once the edit lands, like any edit.
 */
export interface RenameCommand {
  type: "rename";
  pageId: string;
  title: string;
  /** User performing the rename, decimal string. */
  userId: string;
}

export type DocCommand = RestoreCommand | RewriteMediaCommand | RenameCommand;

/** Re-emit a page's media URL forms after a cross-visibility move (ADR 0007). */
export const JOB_MEDIA_REEMIT = "media-reemit";

export interface MediaReemitJobData {
  pageId: string;
}
