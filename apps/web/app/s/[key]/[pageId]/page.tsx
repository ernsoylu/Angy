import Link from "next/link";
import { notFound } from "next/navigation";
import { FileClock, Globe, ShieldCheck, Users } from "lucide-react";
import { Avatar } from "../../../../components/ui/Avatar";
import { Button } from "../../../../components/ui/Button";
import { PageActions } from "../../../../components/pageops/PageActions";
import { RestrictedState } from "../../../../components/ui/SystemState";
import { getMe } from "../../../../lib/api";
import { getReaderPage } from "../../../../lib/reader";
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
        </div>
        <hr className={styles.divider} />
        <div className="article-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      <aside className={shell.rail}>
        {toc.length > 0 && (
          <div className={shell.railGroup}>
            <div className="t-caption">On this page</div>
            <div>
              {toc.map((item, i) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`${shell.tocItem} ${i === 0 ? shell.tocItemActive : ""}`}
                  style={{ display: "block" }}
                >
                  {item.text}
                </a>
              ))}
            </div>
          </div>
        )}
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
