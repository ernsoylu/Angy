import Link from "next/link";
import { notFound } from "next/navigation";
import { FileClock, Globe, Pencil, ShieldCheck, Users } from "lucide-react";
import { Avatar } from "../../../../components/ui/Avatar";
import { Button } from "../../../../components/ui/Button";
import { satisfies } from "@angy/shared";
import { PageActions } from "../../../../components/pageops/PageActions";
import { CommentHighlights } from "../../../../components/comments/CommentHighlights";
import { CommentsRail } from "../../../../components/comments/CommentsRail";
import { Backlinks } from "../../../../components/reader/Backlinks";
import { PageTags } from "../../../../components/reader/PageTags";
import { StarButton } from "../../../../components/reader/StarButton";
import { Toc } from "../../../../components/reader/Toc";
import { RestrictedState } from "../../../../components/ui/SystemState";
import { getMe } from "../../../../lib/api";
import {
  getReaderBacklinks,
  getReaderDatabase,
  getReaderPage,
  getReaderThreads,
  recordVisit,
} from "../../../../lib/reader";
import { DatabaseTable } from "../../../../components/database/DatabaseTable";
import { PageDatabaseButton } from "../../../../components/database/PageDatabaseButton";
import { PageProperties } from "../../../../components/database/PageProperties";
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
  // Everything below needs only the page and the caller, so it goes in one
  // round trip rather than four. This is the read path's whole argument — the
  // reader streams a projection and pays for nothing it does not need — and
  // each rail group added since (backlinks, comments, properties) arrived as
  // one more sequential `await`, quietly turning a TTFB budget into a queue.
  //
  // The visit write rides along: it is throttled in Postgres and swallows its
  // own failures, so nothing here waits on it being useful.
  const [, backlinks, threads, database] = await Promise.all([
    recordVisit(pageId, BigInt(me.id)),
    getReaderBacklinks(pageId, BigInt(me.id), page.spaceId),
    getReaderThreads(pageId),
    getReaderDatabase(pageId, page.spaceId, BigInt(me.id)),
  ]);

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
        {/* Only threads that are still open paint their anchor; a mark whose
            thread was resolved or deleted reads as plain text (ADR 0014). */}
        <CommentHighlights
          threadIds={threads
            .filter((thread) => !thread.resolved && !thread.orphaned)
            .map((thread) => thread.id)}
        />
        <div className="article-prose" dangerouslySetInnerHTML={{ __html: html }} />
        {/* A database is a view over this page's children, so it renders after
            the page's own words rather than replacing them (ADR 0013). */}
        {database.view && <DatabaseTable view={database.view} spaceKey={key} />}
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
        <CommentsRail
          threads={threads}
          canEdit={satisfies(page.level, "EDIT")}
          currentUserId={me.id}
        />
        <PageProperties
          pageId={pageId}
          properties={database.properties}
          initial={database.values}
          canEdit={satisfies(page.level, "EDIT")}
        />
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
          {satisfies(page.level, "EDIT") && (
            <PageDatabaseButton
              pageId={pageId}
              properties={database.properties}
              view={database.view}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
