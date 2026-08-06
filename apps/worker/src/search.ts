import { MeiliSearch } from "meilisearch";
import { getPrisma } from "@angy/db";
import { env } from "./env.js";

/**
 * Search indexing (ADR 0009): a `pages` index over text_extract and an
 * `attachments` index over file metadata. Every document in both carries
 * space_id + page_id — the tenant-token filter
 * (`space_id IN [...] OR page_id IN [...]`) depends on that invariant, and it
 * is what lets one token cover both indexes.
 */

export const SEARCH_INDEX = "pages";
export const ATTACHMENT_INDEX = "attachments";

let client: MeiliSearch | undefined;

function meili(): MeiliSearch {
  client ??= new MeiliSearch({ host: env.meilisearch.url, apiKey: env.meilisearch.apiKey });
  return client;
}

interface PageSearchDocument {
  page_id: string;
  space_id: string;
  space_key: string;
  space_name: string;
  title: string;
  text: string;
  tags: string[];
  parent_title: string | null;
  updated_by_name: string | null;
  updated_at: number;
}

export async function ensureSearchIndex(): Promise<void> {
  await meili().createIndex(SEARCH_INDEX, { primaryKey: "page_id" }).catch(() => undefined);
  await meili()
    .index(SEARCH_INDEX)
    .updateSettings({
      filterableAttributes: ["space_id", "page_id", "updated_at", "tags"],
      sortableAttributes: ["updated_at"],
      // Tags are searchable too: typing a label should find the pages carrying
      // it, not just narrow an existing result set through the facet.
      searchableAttributes: ["title", "text", "tags"],
      displayedAttributes: [
        "page_id",
        "space_id",
        "space_key",
        "space_name",
        "title",
        "text",
        "tags",
        "parent_title",
        "updated_by_name",
        "updated_at",
      ],
    });
}

interface AttachmentSearchDocument {
  attachment_id: string;
  space_id: string;
  space_key: string;
  page_id: string | null;
  page_title: string | null;
  file_name: string;
  mime_type: string;
  /** Broad bucket the Attachments tab filters on: image / document / video. */
  kind: string;
  size_bytes: number;
  uploaded_by_name: string | null;
  created_at: number;
}

function attachmentKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export async function ensureAttachmentIndex(): Promise<void> {
  await meili()
    .createIndex(ATTACHMENT_INDEX, { primaryKey: "attachment_id" })
    .catch(() => undefined);
  await meili()
    .index(ATTACHMENT_INDEX)
    .updateSettings({
      // space_id/page_id are mandatory: the tenant token's read filter is
      // written against them and applies to every index it covers.
      filterableAttributes: ["space_id", "page_id", "kind", "created_at"],
      sortableAttributes: ["created_at"],
      searchableAttributes: ["file_name", "page_title"],
      displayedAttributes: [
        "attachment_id",
        "space_id",
        "space_key",
        "page_id",
        "page_title",
        "file_name",
        "mime_type",
        "kind",
        "size_bytes",
        "uploaded_by_name",
        "created_at",
      ],
    });
}

async function toAttachmentDocument(
  attachmentId: bigint,
): Promise<AttachmentSearchDocument | null> {
  const attachment = await getPrisma().attachment.findUnique({
    where: { id: attachmentId },
    include: { page: { include: { space: true } } },
  });
  // An attachment with no live page has no space, so no read filter could
  // scope it — leave it out rather than index something unreachable.
  if (
    !attachment ||
    attachment.deletedAt ||
    !attachment.page ||
    attachment.page.deletedAt ||
    attachment.page.space.deletedAt
  ) {
    return null;
  }
  const uploader = await getPrisma().appUser.findUnique({
    where: { id: attachment.uploadedBy },
  });
  return {
    attachment_id: attachment.id.toString(),
    space_id: attachment.page.spaceId.toString(),
    space_key: attachment.page.space.key,
    page_id: attachment.pageId,
    page_title: attachment.page.title,
    file_name: attachment.fileName,
    mime_type: attachment.mimeType,
    kind: attachmentKind(attachment.mimeType),
    size_bytes: Number(attachment.sizeBytes),
    uploaded_by_name: uploader?.displayName ?? null,
    created_at: Math.floor(attachment.createdAt.getTime() / 1000),
  };
}

export async function indexAttachment(attachmentId: bigint): Promise<void> {
  const doc = await toAttachmentDocument(attachmentId);
  if (doc) {
    await meili().index(ATTACHMENT_INDEX).addDocuments([doc]);
  } else {
    await meili()
      .index(ATTACHMENT_INDEX)
      .deleteDocument(attachmentId.toString())
      .catch(() => undefined);
  }
}

/** Every attachment on a page — used when the page itself moves or is trashed. */
export async function indexAttachmentsForPage(pageId: string): Promise<void> {
  const rows = await getPrisma().attachment.findMany({
    where: { pageId },
    select: { id: true },
  });
  for (const row of rows) await indexAttachment(row.id);
}

/** Re-index every page and attachment in a space — after it is trashed or restored. */
export async function indexSpace(spaceId: bigint): Promise<number> {
  const pages = await getPrisma().page.findMany({
    where: { spaceId },
    select: { id: true },
  });
  for (const page of pages) {
    await indexPage(page.id);
    await indexAttachmentsForPage(page.id);
  }
  return pages.length;
}

export async function indexAllAttachments(): Promise<number> {
  const rows = await getPrisma().attachment.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  for (const row of rows) await indexAttachment(row.id);
  return rows.length;
}

async function toDocument(pageId: string): Promise<PageSearchDocument | null> {
  const page = await getPrisma().page.findUnique({
    where: { id: pageId },
    include: {
      space: true,
      parent: { select: { title: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  });
  // A trashed space takes its pages out of search with it.
  if (!page || page.deletedAt || page.space.deletedAt) return null;
  const editor = await getPrisma().appUser.findUnique({
    where: { id: page.updatedBy ?? page.createdBy },
  });
  return {
    page_id: page.id,
    space_id: page.spaceId.toString(),
    space_key: page.space.key,
    space_name: page.space.name,
    title: page.title,
    text: page.textExtract ?? "",
    tags: page.tags.map((row) => row.tag.name),
    parent_title: page.parent?.title ?? null,
    updated_by_name: editor?.displayName ?? null,
    updated_at: Math.floor(page.updatedAt.getTime() / 1000),
  };
}

/** Upsert one page into the index (called after every projection rebuild). */
export async function indexPage(pageId: string): Promise<void> {
  const doc = await toDocument(pageId);
  if (doc) {
    await meili().index(SEARCH_INDEX).addDocuments([doc]);
  } else {
    await meili().index(SEARCH_INDEX).deleteDocument(pageId).catch(() => undefined);
  }
}

export async function removeFromIndex(pageId: string): Promise<void> {
  await meili().index(SEARCH_INDEX).deleteDocument(pageId).catch(() => undefined);
}

/** Boot-time backfill so pre-existing pages are searchable. */
export async function indexAllPages(): Promise<number> {
  const pages = await getPrisma().page.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  for (const page of pages) await indexPage(page.id);
  return pages.length;
}
