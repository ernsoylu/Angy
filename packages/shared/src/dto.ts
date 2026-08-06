import { z } from "zod";
import { TAG_MAX_LENGTH } from "./tags.js";

/** Permission levels — dense bigint user ids index the Redis bitmaps (ADR 0004). */
export const permLevelSchema = z.enum(["VIEW", "EDIT", "FULL", "ADMIN"]);
export type PermLevelDto = z.infer<typeof permLevelSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;

export const spaceSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  defaultPermLevel: permLevelSchema,
});
export type SpaceDto = z.infer<typeof spaceSchema>;

/** Flat tree row — clients rebuild the hierarchy from parentId. */
export const pageSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  parentId: z.uuid().nullable(),
});
export type PageSummaryDto = z.infer<typeof pageSummarySchema>;

export const breadcrumbItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
});
export type BreadcrumbItemDto = z.infer<typeof breadcrumbItemSchema>;

export const pageDetailSchema = z.object({
  id: z.uuid(),
  spaceId: z.string(),
  parentId: z.uuid().nullable(),
  title: z.string(),
  slug: z.string(),
  renderedHtml: z.string().nullable(),
  breadcrumb: z.array(breadcrumbItemSchema),
  version: z.number().int().nullable(),
  updatedByName: z.string().nullable(),
  contributors: z.number().int(),
  /** Whether the *requesting* user has starred this page. */
  starred: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PageDetailDto = z.infer<typeof pageDetailSchema>;

/** A tag as the UI sees it: canonical name plus how widely it is used. */
export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  pageCount: z.number().int(),
});
export type TagDto = z.infer<typeof tagSchema>;

/** Replace a page's tags wholesale — names are normalised server-side. */
export const setPageTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(80)).max(25),
});
export type SetPageTagsDto = z.infer<typeof setPageTagsSchema>;

export const renameTagSchema = z.object({
  name: z.string().min(1).max(80),
});
export type RenameTagDto = z.infer<typeof renameTagSchema>;

export const mergeTagSchema = z.object({
  /** The tag this one is folded into; the source tag is deleted. */
  intoId: z.string().regex(/^\d+$/, "intoId is a numeric string"),
});
export type MergeTagDto = z.infer<typeof mergeTagSchema>;

/** A row in the sidebar's Recent or Starred list — per-user, space-scoped. */
export const pageListItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  parentTitle: z.string().nullable(),
  /** Last visit for Recent, star time for Starred. */
  at: z.iso.datetime(),
  updatedByName: z.string().nullable(),
});
export type PageListItemDto = z.infer<typeof pageListItemSchema>;

export const spaceHomeSchema = z.object({
  space: spaceSchema,
  stats: z.object({
    pages: z.number().int(),
    contributors: z.number().int(),
    updatedToday: z.number().int(),
    attachmentBytes: z.number().int(),
  }),
  recentlyUpdated: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      parentTitle: z.string().nullable(),
      updatedByName: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  members: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      permLevel: permLevelSchema,
    }),
  ),
});
export type SpaceHomeDto = z.infer<typeof spaceHomeSchema>;

export const createPageSchema = z.object({
  spaceId: z.string().regex(/^\d+$/, "spaceId is a numeric string"),
  parentId: z.uuid().nullish(),
  title: z.string().min(1).max(200),
});
export type CreatePageDto = z.infer<typeof createPageSchema>;

/**
 * Creating a child from the editor (`/page`). No spaceId and no parentId: the
 * parent is the URL, and its space is derived server-side — a child cannot
 * belong anywhere else.
 */
export const createChildPageSchema = z.object({
  title: z.string().min(1).max(200),
});
export type CreateChildPageDto = z.infer<typeof createChildPageSchema>;

/** Page grant levels — ADMIN is space-only. */
export const grantLevelSchema = z.enum(["VIEW", "EDIT", "FULL"]);

export const pagePermissionsSchema = z.object({
  space: z.object({
    name: z.string(),
    memberCount: z.number().int(),
    baseline: permLevelSchema,
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
  }),
  owner: z.object({ id: z.string(), displayName: z.string(), email: z.email() }).nullable(),
  grants: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      email: z.email(),
      level: grantLevelSchema,
    }),
  ),
  /** Cached bitmaps cleared on save = this page + all descendants. */
  descendants: z.number().int(),
});
export type PagePermissionsDto = z.infer<typeof pagePermissionsSchema>;

export const upsertGrantSchema = z.object({
  email: z.email(),
  level: grantLevelSchema,
});
export type UpsertGrantDto = z.infer<typeof upsertGrantSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sha256: z.string(),
  pageId: z.uuid().nullable(),
  pageTitle: z.string().nullable(),
  /**
   * Every page in the space carrying a blob with this sha256. Uploads are
   * content-addressed, so re-uploading the same file to another page yields a
   * second row over one S3 object — this is what makes it visible.
   */
  usedOnPages: z.array(z.object({ id: z.uuid(), title: z.string() })),
  uploadedByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Bare immutable URL for public spaces; short-lived signed URL for private (ADR 0007). */
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  signed: z.boolean(),
  /**
   * Stable src for embedding in documents: bare CDN URL for public spaces,
   * app-relative /media/... (signed per request at serve time) for private —
   * never a signed URL, which would expire inside the stored document.
   */
  docSrc: z.string(),
});
export type AttachmentDto = z.infer<typeof attachmentSchema>;

/**
 * Space settings (frame 12). The key is absent on purpose: it is baked into
 * every page URL, the Meilisearch tenant filter, and the permission-bitmap
 * prefix, so V1 treats it as permanent — the field renders locked.
 */
export const updateSpaceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  defaultPermLevel: permLevelSchema.optional(),
});
export type UpdateSpaceDto = z.infer<typeof updateSpaceSchema>;

export const createSpaceSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[a-z][a-z0-9-]*$/, "Lowercase letters, digits and hyphens; must start with a letter"),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullish(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  defaultPermLevel: permLevelSchema.default("VIEW"),
});
export type CreateSpaceDto = z.infer<typeof createSpaceSchema>;

export const upsertMemberSchema = z.object({
  email: z.email(),
  permLevel: permLevelSchema,
});
export type UpsertMemberDto = z.infer<typeof upsertMemberSchema>;

export const spaceMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  email: z.email(),
  permLevel: permLevelSchema,
  addedAt: z.iso.datetime(),
});
export type SpaceMemberDto = z.infer<typeof spaceMemberSchema>;

export const renamePageSchema = z.object({
  title: z.string().min(1).max(200),
});
export type RenamePageDto = z.infer<typeof renamePageSchema>;

export const movePageSchema = z.object({
  parentId: z.uuid().nullable(),
  /** Target space for cross-space root moves; ignored when parentId is set. */
  spaceId: z.string().regex(/^\d+$/).optional(),
});
export type MovePageDto = z.infer<typeof movePageSchema>;

export const trashItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  parentTitle: z.string().nullable(),
  spaceName: z.string(),
  trashedByName: z.string().nullable(),
  deletedAt: z.iso.datetime(),
  hardDeleteAt: z.iso.datetime(),
});
export type TrashItemDto = z.infer<typeof trashItemSchema>;

/** Search request for the API-proxied mode (ADR 0009 guardrail). */
export const searchQuerySchema = z.object({
  q: z.string().max(200),
  spaceIds: z.array(z.string().regex(/^\d+$/)).max(50).optional(),
  updatedAfter: z.number().int().optional(),
  tags: z.array(z.string().max(TAG_MAX_LENGTH)).max(10).optional(),
});
export type SearchQueryDto = z.infer<typeof searchQuerySchema>;

export const revisionSchema = z.object({
  version: z.number().int(),
  label: z.string().nullable(),
  authorName: z.string().nullable(),
  current: z.boolean(),
  sizeBytes: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type RevisionDto = z.infer<typeof revisionSchema>;
