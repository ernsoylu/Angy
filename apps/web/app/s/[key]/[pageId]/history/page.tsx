import Link from "next/link";
import { notFound } from "next/navigation";
import {
  diffDocuments,
  diffWords,
  renderDocumentToHtml,
  type DiffBlock,
  type JSONContent,
} from "@angy/blocks";
import { RestoreButton } from "../../../../../components/history/RestoreButton";
import { Avatar } from "../../../../../components/ui/Avatar";
import { Badge } from "../../../../../components/ui/Badge";
import { Callout } from "../../../../../components/ui/Callout";
import { cx } from "../../../../../lib/cx";
import { getMe, getRevisionContent, getRevisions } from "../../../../../lib/api";
import { getReaderPage } from "../../../../../lib/reader";
import { timeAgo } from "../../../../../lib/time";
import shell from "../../../../../components/shell/shell.module.css";
import styles from "./history.module.css";

const blockHtml = (node: JSONContent) =>
  renderDocumentToHtml({ type: "doc", content: [node] });

const INLINE_DIFF_TYPES = new Set(["paragraph", "heading"]);

function DiffBlockView({ block }: { block: DiffBlock }) {
  if (block.kind === "same") {
    return <div dangerouslySetInnerHTML={{ __html: blockHtml(block.node) }} />;
  }
  if (block.kind === "added") {
    return (
      <div className={styles.blockAdded}>
        <div dangerouslySetInnerHTML={{ __html: blockHtml(block.node) }} />
      </div>
    );
  }
  if (block.kind === "removed") {
    return (
      <div className={styles.blockRemoved}>
        <div dangerouslySetInnerHTML={{ __html: blockHtml(block.node) }} />
      </div>
    );
  }
  // Modified: word-level inline diff for text blocks, side-by-side otherwise.
  if (INLINE_DIFF_TYPES.has(block.to.type ?? "")) {
    const parts = diffWords(block.from, block.to);
    const Tag = block.to.type === "heading" ? "h2" : "p";
    return (
      <Tag className={block.to.type === "heading" ? "t-h2" : "t-body"}>
        {parts.map((part, i) => (
          <span
            key={i}
            className={
              part.type === "added" ? styles.ins : part.type === "removed" ? styles.del : undefined
            }
          >
            {part.text}
            {i < parts.length - 1 ? " " : ""}
          </span>
        ))}
      </Tag>
    );
  }
  return (
    <>
      <div className={styles.blockRemoved}>
        <div dangerouslySetInnerHTML={{ __html: blockHtml(block.from) }} />
      </div>
      <div className={styles.blockAdded}>
        <div dangerouslySetInnerHTML={{ __html: blockHtml(block.to) }} />
      </div>
    </>
  );
}

/** Version history & diff per frontend.pen frame 4. */
export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; pageId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ key, pageId }, query, me] = await Promise.all([params, searchParams, getMe()]);
  const page = await getReaderPage(pageId, BigInt(me.id));
  if (!page || page === "forbidden") notFound();

  const revisions = await getRevisions(pageId);
  if (revisions.length === 0) {
    return (
      <div className={shell.readerGrid}>
        <article className={shell.article}>
          <div className="t-caption">Version history</div>
          <h1 className="t-title" style={{ marginBottom: 16 }}>
            {page.title}
          </h1>
          <Callout tone="note">
            No revisions yet — checkpoints are written when an editor finishes a session.
          </Callout>
        </article>
      </div>
    );
  }

  const latest = revisions[0]!.version;
  const to = Number(query.to ?? latest);
  const from = Number(query.from ?? Math.max(1, to - 1));
  const canDiff = revisions.length > 1 && from !== to;

  const [fromContent, toContent] = await Promise.all([
    getRevisionContent(pageId, from),
    getRevisionContent(pageId, to),
  ]);
  const diff = diffDocuments(fromContent.documentJson, toContent.documentJson);
  const fromMeta = revisions.find((r) => r.version === from);

  return (
    <div className={shell.readerGrid}>
      <article className={shell.article}>
        <div className="t-caption">Version history</div>
        <h1 className="t-title">{page.title}</h1>

        <div className={styles.compareBar}>
          <span className={styles.versionChip}>
            v{from} <span>{fromMeta ? timeAgo(fromMeta.createdAt) : ""}</span>
          </span>
          →
          <span className={styles.versionChip}>
            v{to} <span>{timeAgo(revisions.find((r) => r.version === to)?.createdAt ?? "")}</span>
          </span>
          <span className={styles.legend}>
            <span>
              <span className={styles.legendSwatch} style={{ background: "var(--sage-soft)", border: "1px solid var(--sage)" }} />
              Added
            </span>
            <span>
              <span className={styles.legendSwatch} style={{ background: "var(--clay-soft)", border: "1px solid var(--clay)" }} />
              Removed
            </span>
          </span>
          {from !== latest && <RestoreButton pageId={pageId} version={from} />}
        </div>

        <Callout tone="note">
          Restoring is non-destructive — v{from} is re-applied as a new version v{latest + 1}.
          Nothing in the history is rewritten.
        </Callout>

        <div className={cx("article-prose", styles.diffBody)} style={{ marginTop: 20 }}>
          {canDiff ? (
            diff.map((block, i) => <DiffBlockView key={i} block={block} />)
          ) : (
            <div
              className="article-prose"
              dangerouslySetInnerHTML={{ __html: renderDocumentToHtml(toContent.documentJson) }}
            />
          )}
        </div>
      </article>

      <aside className={shell.rail}>
        <div className={shell.railGroup}>
          <div className="t-caption">Revisions</div>
          <div>
            {revisions.map((rev) => (
              <Link
                key={rev.version}
                href={`/s/${key}/${pageId}/history?from=${rev.version}&to=${latest}`}
                className={cx(styles.revRow, rev.version === from && styles.revRowActive)}
              >
                <span className={styles.revVersion}>v{rev.version}</span>
                {rev.authorName && <Avatar name={rev.authorName} size={22} />}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className={styles.revName}>{rev.authorName ?? "Unknown"}</span>
                  <span className={styles.revTime} style={{ display: "block" }}>
                    {timeAgo(rev.createdAt)}
                  </span>
                </span>
                {rev.current && <Badge hue="accent">current</Badge>}
                {rev.label === "compaction" && <Badge hue="neutral">compaction</Badge>}
                {rev.label?.startsWith("restore") && <Badge hue="sage">restore</Badge>}
              </Link>
            ))}
          </div>
        </div>
        <p className={styles.railNote}>
          Each revision is a full Y.Doc state blob in S3. Diffs are computed on the rendered
          document, not on CRDT internals.
        </p>
      </aside>
    </div>
  );
}
