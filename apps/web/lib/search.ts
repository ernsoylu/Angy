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
  parent_title: string | null;
  updated_by_name: string | null;
  updated_at: number;
  _formatted?: { title?: string; text?: string };
}

export interface SearchResult {
  hits: SearchHit[];
  estimatedTotalHits: number;
  processingTimeMs: number;
  facetDistribution?: { space_id?: Record<string, number> };
}

export async function searchPages(
  q: string,
  options: { spaceIds?: string[]; updatedAfter?: number } = {},
): Promise<SearchResult> {
  const token = await getSearchToken();
  const filter: string[] = [];
  if (options.spaceIds?.length) {
    filter.push(`space_id IN [${options.spaceIds.map((id) => `"${id}"`).join(", ")}]`);
  }
  if (options.updatedAfter) filter.push(`updated_at >= ${options.updatedAfter}`);

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
      facets: ["space_id"],
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
