import { z } from "zod";

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PageDetailDto = z.infer<typeof pageDetailSchema>;

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
  uploadedByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Bare immutable URL for public spaces; short-lived signed URL for private (ADR 0007). */
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  signed: z.boolean(),
});
export type AttachmentDto = z.infer<typeof attachmentSchema>;

export const movePageSchema = z.object({
  parentId: z.uuid().nullable(),
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

export const revisionSchema = z.object({
  version: z.number().int(),
  label: z.string().nullable(),
  authorName: z.string().nullable(),
  current: z.boolean(),
  sizeBytes: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type RevisionDto = z.infer<typeof revisionSchema>;
