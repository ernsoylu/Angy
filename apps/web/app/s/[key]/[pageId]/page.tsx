import Link from "next/link";
import { notFound } from "next/navigation";
import { FileClock, Globe, Pencil, ShieldCheck, Users } from "lucide-react";
import { Avatar } from "../../../../components/ui/Avatar";
import { Button } from "../../../../components/ui/Button";
import { satisfies } from "@angy/shared";
import { PageActions } from "../../../../components/pageops/PageActions";
import { Backlinks } from "../../../../components/reader/Backlinks";
import { PageTags } from "../../../../components/reader/PageTags";
import { StarButton } from "../../../../components/reader/StarButton";
import { Toc } from "../../../../components/reader/Toc";
import { RestrictedState } from "../../../../components/ui/SystemState";
import { getMe } from "../../../../lib/api";
import { getReaderBacklinks, getReaderPage, recordVisit } from "../../../../lib/reader";
import { timeAgo } from "../../../../lib/time";
import { injectToc } from "../../../../lib/toc";
import shell from "../../../../components/shell/shell.module.css";
import styles from "./reader.module.css";

/**
 * The SSR read path (frame 1): streams the worker-rendered projection HTML.
 * No editor JS is shipped here — the editor mounts only behind Edit (Phase 4).
 */
export default async function ReaderPage({
  params,
}: {
  params: Promise<{ key: string; pageId: string }>;
}) {
  const { key, pageId } = await params;
  const me = await getMe();
  const page = await getReaderPage(pageId, BigInt(me.id));
  if (!page) notFound();
  if (page === "forbidden") return <RestrictedState />;
  // Reading history for the sidebar's Recent list — throttled in Postgres, so
  // reloads and route prefetches don't turn into a write each.
  await recordVisit(pageId, BigInt(me.id));
  const backlinks = await getReaderBacklinks(pageId, BigInt(me.id), page.spaceId);

  const { html, toc } = injectToc(page.renderedHtml ?? "");
  const parents = page.breadcrumb.slice(0, -1);

  return (
    <div className={shell.readerGrid}>
      <article className={shell.article}>
        <nav className={styles.breadcrumb}>
          <Link href={`/s/${key}`}>{key === "eng" ? "Engineering" : key}</Link>
          {parents.map((crumb) => (
            <span key={crumb.id}>
              {" › "}
              <Link href={`/s/${key}/${crumb.id}`}>{crumb.title}</Link>
            </span>
          ))}
          <span> › </span>
          <span style={{ color: "var(--text)" }}>{page.title}</span>
        </nav>
        <h1 className="t-title">{page.title}</h1>
        <div className={styles.byline}>
          {page.updatedByName && <Avatar name={page.updatedByName} size={22} />}
          <span>
            {page.updatedByName ? `Updated by ${page.updatedByName}` : "Updated"} ·{" "}
            {timeAgo(page.updatedAt)}
            {page.version !== null && ` · v${page.version}`}
          </span>
          <PageTags
            pageId={pageId}
            spaceKey={key}
            initial={page.tags}
            canEdit={satisfies(page.level, "EDIT")}
          />
        </div>
        <hr className={styles.divider} />
        <div className="article-prose" dangerouslySetInnerHTML={{ __html: html }} />
        {/* Frame E mobile: full-width edit affordance replaces the hidden top-bar button. */}
        <Link href={`/s/${key}/${pageId}/edit`} className={styles.mobileEdit}>
          <Button icon={<Pencil size={15} />} style={{ width: "100%" }}>
            Edit this page
          </Button>
        </Link>
      </article>

      <aside className={shell.rail}>
        {toc.length > 0 && (
          <div className={shell.railGroup}>
            <div className="t-caption">On this page</div>
            <Toc items={toc} />
          </div>
        )}
        {/* Inbound navigation sits with in-page navigation, above the metadata. */}
        <Backlinks links={backlinks.shown} hidden={backlinks.hidden} />
        <div className={shell.railGroup}>
          <div className="t-caption">Page info</div>
          {page.version !== null && (
            <div className={shell.railItem}>
              <FileClock size={14} /> Version {page.version}
            </div>
          )}
          <div className={shell.railItem}>
            <Users size={14} /> {page.contributors} contributor{page.contributors === 1 ? "" : "s"}
          </div>
          <div className={shell.railItem}>
            <ShieldCheck size={14} /> Inherits space perms
          </div>
          <div className={shell.railItem}>
            <Globe size={14} /> Public to workspace
          </div>
          <StarButton pageId={pageId} initial={page.starred} />
          <Link href={`/s/${key}/${pageId}/history`}>
            <Button variant="secondary" icon={<FileClock size={14} />} style={{ marginTop: 6 }}>
              View history
            </Button>
          </Link>
        </div>
        <div className={shell.railGroup}>
          <div className="t-caption">Page actions</div>
          <PageActions pageId={pageId} pageTitle={page.title} spaceKey={key} />
        </div>
      </aside>
    </div>
  );
}
