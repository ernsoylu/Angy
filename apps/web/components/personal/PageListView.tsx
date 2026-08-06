import Link from "next/link";
import { FileText } from "lucide-react";
import type { PageListItemDto } from "@angy/shared";
import { Avatar } from "../ui/Avatar";
import { EmptyState } from "../ui/SystemState";
import { timeAgo } from "../../lib/time";
import shell from "../shell/shell.module.css";
import styles from "./page-list.module.css";

interface PageListViewProps {
  title: string;
  subtitle: string;
  spaceKey: string;
  items: PageListItemDto[];
  /** Verb for the per-row timestamp, e.g. "Read" or "Starred". */
  timeLabel: string;
  empty: { title: string; body: string };
}

/** Shared shell for the sidebar's Recent and Starred lists (Wave C). */
export function PageListView({
  title,
  subtitle,
  spaceKey,
  items,
  timeLabel,
  empty,
}: PageListViewProps) {
  return (
    <div className={shell.readerGrid}>
      <div className={shell.article} style={{ maxWidth: 900 }}>
        <h1 className="t-title" style={{ fontSize: 32 }}>
          {title}
        </h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {items.length === 0 ? (
          // Purely informational: these lists fill themselves as you read and
          // star, so there is no action to offer.
          <EmptyState title={empty.title} body={empty.body} action={null} />
        ) : (
          <div className={styles.list}>
            {items.map((item) => (
              <Link key={item.id} href={`/s/${spaceKey}/${item.id}`} className={styles.row}>
                <FileText size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  {item.parentTitle && <span className={styles.rowCrumb}>{item.parentTitle}</span>}
                </span>
                <span className={styles.rowMeta}>
                  {item.updatedByName && <Avatar name={item.updatedByName} size={22} />}
                  {timeLabel} {timeAgo(item.at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
