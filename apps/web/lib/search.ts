import "server-only";
import { getSearchToken } from "./api";

/**
 * Query Meilisearch with the user's tenant token (ADR 0009). The token's
 * embedded searchRules filter is ANDed by Meilisearch with anything we pass
 * here — the read-set restriction cannot be bypassed from this side.
 */

export const HL_OPEN = "__HL__";
export const HL_CLOSE = "__/HL__";

export interface SearchHit {
  page_id: string;
  space_id: string;
  space_key: string;
  space_name: string;
  title: string;
  tags: string[];
  parent_title: string | null;
  updated_by_name: string | null;
  updated_at: number;
  _formatted?: { title?: string; text?: string };
}

export interface SearchResult {
  hits: SearchHit[];
  estimatedTotalHits: number;
  processingTimeMs: number;
  facetDistribution?: { space_id?: Record<string, number>; tags?: Record<string, number> };
}

export interface SearchOptions {
  spaceIds?: string[];
  updatedAfter?: number;
  /** Tag names, ANDed with the read filter — a page must carry all of them. */
  tags?: string[];
}

export async function searchPages(
  q: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const token = await getSearchToken();

  // ADR 0009 guardrail: oversized grant lists fall back to API-proxied search.
  if (token.mode === "proxy") {
    return searchViaApi(q, options);
  }

  const filter: string[] = [];
  if (options.spaceIds?.length) {
    filter.push(`space_id IN [${options.spaceIds.map((id) => `"${id}"`).join(", ")}]`);
  }
  if (options.updatedAfter) filter.push(`updated_at >= ${options.updatedAfter}`);
  // Names are normalised on write (normalizeTag strips quote/bracket
  // characters), so interpolating them as literals here is safe.
  for (const tag of options.tags ?? []) filter.push(`tags = "${tag}"`);

  const res = await fetch(`${token.host}/indexes/${token.indexUid}/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q,
      limit: 20,
      filter,
      facets: ["space_id", "tags"],
      attributesToHighlight: ["title", "text"],
      highlightPreTag: HL_OPEN,
      highlightPostTag: HL_CLOSE,
      attributesToCrop: ["text"],
      cropLength: 28,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return (await res.json()) as SearchResult;
}

export interface AttachmentHit {
  attachment_id: string;
  space_id: string;
  space_key: string;
  page_id: string | null;
  page_title: string | null;
  file_name: string;
  mime_type: string;
  kind: string;
  size_bytes: number;
  uploaded_by_name: string | null;
  created_at: number;
  _formatted?: { file_name?: string };
}

export interface AttachmentSearchResult {
  hits: AttachmentHit[];
  estimatedTotalHits: number;
  processingTimeMs: number;
}

/**
 * The Attachments tab (frame 3). The tenant token's searchRules cover this
 * index too, so the same read filter applies — an attachment is exactly as
 * readable as the page it hangs off.
 *
 * Guardrailed users (oversized grant lists) get no attachment search: the
 * proxy endpoint serves pages only, and silently returning nothing would read
 * as "no files matched". They are told instead.
 */
export async function searchAttachments(
  q: string,
  options: { spaceIds?: string[] } = {},
): Promise<AttachmentSearchResult | "unavailable"> {
  const token = await getSearchToken();
  if (token.mode === "proxy") return "unavailable";

  const filter: string[] = [];
  if (options.spaceIds?.length) {
    filter.push(`space_id IN [${options.spaceIds.map((id) => `"${id}"`).join(", ")}]`);
  }

  const res = await fetch(`${token.host}/indexes/${token.attachmentIndexUid}/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q,
      limit: 20,
      filter,
      attributesToHighlight: ["file_name"],
      highlightPreTag: HL_OPEN,
      highlightPostTag: HL_CLOSE,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Attachment search failed: ${res.status}`);
  return (await res.json()) as AttachmentSearchResult;
}

async function searchViaApi(q: string, options: SearchOptions): Promise<SearchResult> {
  const { cookies } = await import("next/headers");
  const API_URL =
    process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const res = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: {
      cookie: (await cookies()).toString(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q,
      spaceIds: options.spaceIds,
      updatedAfter: options.updatedAfter,
      tags: options.tags,
    }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!body.success) throw new Error(body.error.message);
  return body.data as SearchResult;
}

/** Split highlighted text into renderable parts (no raw HTML reaches React). */
export function highlightParts(text: string): { highlighted: boolean; text: string }[] {
  const parts: { highlighted: boolean; text: string }[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf(HL_OPEN);
    if (open === -1) {
      parts.push({ highlighted: false, text: rest });
      break;
    }
    if (open > 0) parts.push({ highlighted: false, text: rest.slice(0, open) });
    const close = rest.indexOf(HL_CLOSE, open);
    if (close === -1) {
      parts.push({ highlighted: false, text: rest.slice(open + HL_OPEN.length) });
      break;
    }
    parts.push({ highlighted: true, text: rest.slice(open + HL_OPEN.length, close) });
    rest = rest.slice(close + HL_CLOSE.length);
  }
  return parts;
}
