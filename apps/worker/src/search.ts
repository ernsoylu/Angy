import { MeiliSearch } from "meilisearch";
import { getPrisma } from "@angy/db";
import { env } from "./env.js";

/**
 * Search indexing (ADR 0009): one shared `pages` index over text_extract.
 * Every document carries space_id + page_id — the tenant-token filter
 * (`space_id IN [...] OR page_id IN [...]`) depends on that invariant.
 */

export const SEARCH_INDEX = "pages";

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
  parent_title: string | null;
  updated_by_name: string | null;
  updated_at: number;
}

export async function ensureSearchIndex(): Promise<void> {
  await meili().createIndex(SEARCH_INDEX, { primaryKey: "page_id" }).catch(() => undefined);
  await meili()
    .index(SEARCH_INDEX)
    .updateSettings({
      filterableAttributes: ["space_id", "page_id", "updated_at"],
      sortableAttributes: ["updated_at"],
      searchableAttributes: ["title", "text"],
      displayedAttributes: [
        "page_id",
        "space_id",
        "space_key",
        "space_name",
        "title",
        "text",
        "parent_title",
        "updated_by_name",
        "updated_at",
      ],
    });
}

async function toDocument(pageId: string): Promise<PageSearchDocument | null> {
  const page = await getPrisma().page.findUnique({
    where: { id: pageId },
    include: { space: true, parent: { select: { title: true } } },
  });
  if (!page || page.deletedAt) return null;
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
