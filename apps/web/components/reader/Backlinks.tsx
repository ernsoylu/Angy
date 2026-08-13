import Link from "next/link";
import { Link2 } from "lucide-react";
import type { ReaderBacklink } from "../../lib/reader";
import shell from "../shell/shell.module.css";
import styles from "./backlinks.module.css";

/**
 * "Linked from" — the reader-side consumer of `block_index` (V2 H1).
 *
 * Server-rendered with the rest of the rail: the list is already resolved and
 * permission-filtered by the time this renders, so there is nothing to fetch
 * on the client and no editor JS enters the read path.
 *
 * Every row resolves through `/p/{id}` rather than `/s/{key}/{id}`, for the
 * same reason page links do: a space key baked into a URL goes stale the moment
 * the page moves, and the redirect costs one hop.
 */
export function Backlinks({
  links,
  hidden,
}: {
  links: ReaderBacklink[];
  hidden: number;
}) {
  if (links.length === 0) return null;

  return (
    <div className={shell.railGroup} data-testid="backlinks">
      <div className="t-caption">Linked from</div>
      {links.map((link) => (
        <Link key={link.id} href={`/p/${link.id}`} className={styles.item}>
          <Link2 size={14} className={styles.icon} />
          <span className={styles.title}>{link.title}</span>
          {link.spaceName && <span className={styles.space}>{link.spaceName}</span>}
          {link.count > 1 && <span className={styles.count}>×{link.count}</span>}
        </Link>
      ))}
      {hidden > 0 && (
        // Say what was left out rather than quietly showing a short list.
        <div className={styles.more}>and {hidden} more</div>
      )}
    </div>
  );
}
