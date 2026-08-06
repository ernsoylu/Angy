import Link from "next/link";
import { Check } from "lucide-react";
import { Avatar } from "../../../../components/ui/Avatar";
import { Chip } from "../../../../components/ui/Tag";
import { EmptyState } from "../../../../components/ui/SystemState";
import { cx } from "../../../../lib/cx";
import { getSpaces } from "../../../../lib/api";
import { highlightParts, searchPages, type SearchHit } from "../../../../lib/search";
import { timeAgo } from "../../../../lib/time";
import shell from "../../../../components/shell/shell.module.css";
import styles from "./search.module.css";

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {highlightParts(text).map((part, i) =>
        part.highlighted ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

function Hit({ hit, first }: { hit: SearchHit; first: boolean }) {
  return (
    <Link
      href={`/s/${hit.space_key}/${hit.page_id}`}
      className={cx(styles.hit, first && styles.hitFirst)}
    >
      <div className={styles.hitCrumb}>
        {hit.space_name}
        {hit.parent_title && ` › ${hit.parent_title}`}
      </div>
      <div className={styles.hitTitle}>
        <Highlighted text={hit._formatted?.title ?? hit.title} />
      </div>
      <div className={styles.hitSnippet}>
        <Highlighted text={hit._formatted?.text ?? ""} />
      </div>
      <div className={styles.hitMeta}>
        {hit.updated_by_name && (
          <>
            <Avatar name={hit.updated_by_name} size={18} />
            {hit.updated_by_name} ·
          </>
        )}
        {timeAgo(new Date(hit.updated_at * 1000).toISOString())}
      </div>
    </Link>
  );
}

const UPDATED_OPTIONS = [
  { key: "week", label: "Past week", seconds: 7 * 86400 },
  { key: "month", label: "Past month", seconds: 30 * 86400 },
  { key: "any", label: "Any time", seconds: 0 },
] as const;

/** Search screen per frontend.pen frame 3 — tenant-token scoped (ADR 0009). */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ q?: string; spaces?: string; updated?: string }>;
}) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const q = (query.q ?? "").trim();
  const selectedSpaces = query.spaces?.split(",").filter(Boolean) ?? [];
  const updated = UPDATED_OPTIONS.find((o) => o.key === query.updated) ?? UPDATED_OPTIONS[2];

  if (!q) {
    return (
      <EmptyState
        title="Search your knowledge base"
        body="Typo-tolerant search across every space you can read. Try the search field above."
        actionLabel="Back to space"
      />
    );
  }

  const [result, allSpaces] = await Promise.all([
    searchPages(q, {
      spaceIds: selectedSpaces.length ? selectedSpaces : undefined,
      updatedAfter: updated.seconds
        ? Math.floor(Date.now() / 1000) - updated.seconds
        : undefined,
    }),
    getSpaces(),
  ]);

  const spaceCounts = result.facetDistribution?.space_id ?? {};
  const spacesInResults = new Set(result.hits.map((h) => h.space_id)).size;

  const facetHref = (overrides: { spaces?: string[]; updated?: string }) => {
    const p = new URLSearchParams({ q });
    const spaces = overrides.spaces ?? selectedSpaces;
    if (spaces.length) p.set("spaces", spaces.join(","));
    const u = overrides.updated ?? updated.key;
    if (u !== "any") p.set("updated", u);
    return `/s/${key}/search?${p.toString()}`;
  };

  return (
    <div className={shell.readerGrid}>
      <div className={shell.article} style={{ maxWidth: 860 }}>
        <h1 className={styles.queryTitle}>&ldquo;{q}&rdquo;</h1>
        <div className={styles.meta}>
          {result.estimatedTotalHits} result{result.estimatedTotalHits === 1 ? "" : "s"} across{" "}
          {spacesInResults} space{spacesInResults === 1 ? "" : "s"} · {result.processingTimeMs} ms
          · scoped to what you can read
        </div>

        <div className={styles.tabs}>
          <Chip selected>All results</Chip>
          <Chip>Pages</Chip>
          <Chip>Attachments</Chip>
        </div>

        {result.hits.length === 0 ? (
          <EmptyState
            title={`No results for "${q}"`}
            body="Try fewer or different keywords — search is typo-tolerant, so close is good enough."
            actionLabel="Clear search"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.hits.map((hit, i) => (
              <Hit key={hit.page_id} hit={hit} first={i === 0} />
            ))}
          </div>
        )}
      </div>

      <aside className={shell.rail}>
        <div className={shell.railGroup}>
          <div className="t-caption">Spaces</div>
          <div>
            {allSpaces.map((space) => {
              const active = selectedSpaces.includes(space.id);
              const next = active
                ? selectedSpaces.filter((id) => id !== space.id)
                : [...selectedSpaces, space.id];
              return (
                <Link
                  key={space.id}
                  href={facetHref({ spaces: next })}
                  className={cx(styles.facetRow, active && styles.facetActive)}
                >
                  <span className={cx(styles.checkbox, active && styles.checkboxOn)}>
                    {active && <Check size={11} />}
                  </span>
                  {space.name}
                  <span className={styles.facetCount}>{spaceCounts[space.id] ?? 0}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <div className={shell.railGroup}>
          <div className="t-caption">Updated</div>
          <div>
            {UPDATED_OPTIONS.map((option) => (
              <Link
                key={option.key}
                href={facetHref({ updated: option.key })}
                className={cx(styles.facetRow, updated.key === option.key && styles.facetActive)}
              >
                {option.label}
              </Link>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
