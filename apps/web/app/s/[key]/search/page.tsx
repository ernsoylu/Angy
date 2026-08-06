import Link from "next/link";
import { Check, FileText, Paperclip } from "lucide-react";
import { Avatar } from "../../../../components/ui/Avatar";
import { Callout } from "../../../../components/ui/Callout";
import { Button } from "../../../../components/ui/Button";
import { EmptyState } from "../../../../components/ui/SystemState";
import { cx } from "../../../../lib/cx";
import { getSpaces } from "../../../../lib/api";
import {
  highlightParts,
  searchAttachments,
  searchPages,
  type AttachmentHit,
  type SearchHit,
} from "../../../../lib/search";
import { formatBytes, timeAgo } from "../../../../lib/time";
import shell from "../../../../components/shell/shell.module.css";
import ui from "../../../../components/ui/ui.module.css";
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

function AttachmentCard({ hit }: { hit: AttachmentHit }) {
  return (
    <Link
      href={hit.page_id ? `/s/${hit.space_key}/${hit.page_id}` : `/s/${hit.space_key}/attachments`}
      className={styles.hit}
    >
      <div className={styles.hitCrumb}>
        {hit.page_title ?? "Unattached"} · {hit.kind}
      </div>
      <div className={styles.hitTitle}>
        <Paperclip size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        <Highlighted text={hit._formatted?.file_name ?? hit.file_name} />
      </div>
      <div className={styles.hitMeta}>
        {hit.uploaded_by_name && (
          <>
            <Avatar name={hit.uploaded_by_name} size={18} />
            {hit.uploaded_by_name} ·
          </>
        )}
        {formatBytes(hit.size_bytes)} · {timeAgo(new Date(hit.created_at * 1000).toISOString())}
      </div>
    </Link>
  );
}

const TABS = [
  { key: "all", label: "All results" },
  { key: "pages", label: "Pages" },
  { key: "attachments", label: "Attachments" },
] as const;

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
  searchParams: Promise<{
    q?: string;
    spaces?: string;
    updated?: string;
    tags?: string;
    tab?: string;
  }>;
}) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const q = (query.q ?? "").trim();
  const selectedSpaces = query.spaces?.split(",").filter(Boolean) ?? [];
  const selectedTags = query.tags?.split(",").filter(Boolean) ?? [];
  const updated = UPDATED_OPTIONS.find((o) => o.key === query.updated) ?? UPDATED_OPTIONS[2];
  const tab = TABS.find((t) => t.key === query.tab) ?? TABS[0];

  if (!q) {
    return (
      <EmptyState
        title="Search your knowledge base"
        body="Typo-tolerant search across every space you can read. Try the search field above."
        action={
          <Button href={`/s/${key}`} variant="secondary">
            Back to space
          </Button>
        }
      />
    );
  }

  const [result, allSpaces, attachments] = await Promise.all([
    searchPages(q, {
      spaceIds: selectedSpaces.length ? selectedSpaces : undefined,
      updatedAfter: updated.seconds
        ? Math.floor(Date.now() / 1000) - updated.seconds
        : undefined,
      tags: selectedTags.length ? selectedTags : undefined,
    }),
    getSpaces(),
    tab.key === "pages"
      ? Promise.resolve(null)
      : searchAttachments(q, {
          spaceIds: selectedSpaces.length ? selectedSpaces : undefined,
        }),
  ]);

  const spaceCounts = result.facetDistribution?.space_id ?? {};
  // Facet counts come back for the *current* result set; a selected tag stays
  // listed even at zero so it can be switched off again.
  const tagCounts = result.facetDistribution?.tags ?? {};
  const tagNames = [...new Set([...Object.keys(tagCounts), ...selectedTags])].sort(
    (a, b) => (tagCounts[b] ?? 0) - (tagCounts[a] ?? 0) || a.localeCompare(b),
  );
  const spacesInResults = new Set(result.hits.map((h) => h.space_id)).size;

  const facetHref = (overrides: {
    spaces?: string[];
    updated?: string;
    tags?: string[];
    tab?: string;
  }) => {
    const p = new URLSearchParams({ q });
    const spaces = overrides.spaces ?? selectedSpaces;
    if (spaces.length) p.set("spaces", spaces.join(","));
    const u = overrides.updated ?? updated.key;
    if (u !== "any") p.set("updated", u);
    const tags = overrides.tags ?? selectedTags;
    if (tags.length) p.set("tags", tags.join(","));
    const t = overrides.tab ?? tab.key;
    if (t !== "all") p.set("tab", t);
    return `/s/${key}/search?${p.toString()}`;
  };

  const attachmentHits =
    attachments && attachments !== "unavailable" ? attachments.hits : [];
  const showPages = tab.key !== "attachments";
  const showAttachments = tab.key !== "pages";
  const nothingToShow =
    (!showPages || result.hits.length === 0) && (!showAttachments || attachmentHits.length === 0);

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
          {TABS.map((option) => (
            <Link
              key={option.key}
              href={facetHref({ tab: option.key })}
              className={cx(ui.chip, tab.key === option.key && ui.chipSelected)}
            >
              {option.label}
            </Link>
          ))}
        </div>

        {attachments === "unavailable" && showAttachments && (
          <Callout tone="note">
            Your access list is large enough that search runs through the API
            (ADR 0009), which covers pages only. Files are still browsable from
            the Attachments screen.
          </Callout>
        )}

        {nothingToShow ? (
          <EmptyState
            title={`No results for "${q}"`}
            body="Try fewer or different keywords — search is typo-tolerant, so close is good enough."
            action={null}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {showPages &&
              result.hits.map((hit, i) => (
                <Hit key={hit.page_id} hit={hit} first={i === 0} />
              ))}
            {showAttachments && attachmentHits.length > 0 && (
              <>
                {tab.key === "all" && result.hits.length > 0 && (
                  <div className={cx("t-caption", styles.sectionCaption)}>
                    <FileText size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
                    Attachments
                  </div>
                )}
                {attachmentHits.map((hit) => (
                  <AttachmentCard key={hit.attachment_id} hit={hit} />
                ))}
              </>
            )}
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
        {tagNames.length > 0 && (
          <div className={shell.railGroup}>
            <div className="t-caption">Tags</div>
            <div>
              {tagNames.map((name) => {
                const active = selectedTags.includes(name);
                const next = active
                  ? selectedTags.filter((t) => t !== name)
                  : [...selectedTags, name];
                return (
                  <Link
                    key={name}
                    href={facetHref({ tags: next })}
                    className={cx(styles.facetRow, active && styles.facetActive)}
                  >
                    <span className={cx(styles.checkbox, active && styles.checkboxOn)}>
                      {active && <Check size={11} />}
                    </span>
                    {name}
                    <span className={styles.facetCount}>{tagCounts[name] ?? 0}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
