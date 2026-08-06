import Link from "next/link";
import { notFound } from "next/navigation";
import { Cpu, FileText, Plus } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { Button } from "../../../components/ui/Button";
import { Callout } from "../../../components/ui/Callout";
import { EmptyState } from "../../../components/ui/SystemState";
import { getSpaceByKey, getSpaceHome } from "../../../lib/api";
import { formatBytes, timeAgo } from "../../../lib/time";
import shell from "../../../components/shell/shell.module.css";
import ui from "../../../components/ui/ui.module.css";
import styles from "./space-home.module.css";

const LEVEL_LABEL: Record<string, string> = {
  VIEW: "Can view",
  EDIT: "Can edit",
  FULL: "Full access",
  ADMIN: "Admin",
};

/** Space home per frontend.pen frame 5. */
export default async function SpaceHomePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const home = await getSpaceHome(space.id);

  return (
    <div className={shell.readerGrid}>
      <div className={shell.article} style={{ maxWidth: 900 }}>
        <header className={styles.header}>
          <span className={styles.spaceIcon}>
            <Cpu size={24} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="t-title" style={{ fontSize: 32 }}>
              {home.space.name}
            </h1>
            {home.space.description && <p className={styles.description}>{home.space.description}</p>}
          </div>
          <Button icon={<Plus size={14} />}>New page</Button>
        </header>

        <div className={styles.stats}>
          {[
            [home.stats.pages, "Pages"],
            [home.stats.contributors, "Contributors"],
            [home.stats.updatedToday, "Updated today"],
            [formatBytes(home.stats.attachmentBytes), "Attachments"],
          ].map(([value, label]) => (
            <div key={label} className={styles.statCard}>
              <div className={styles.statValue}>{value}</div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>

        <div className={`t-caption ${styles.sectionCaption}`}>Recently updated</div>
        {home.recentlyUpdated.length === 0 ? (
          <EmptyState />
        ) : (
          <div className={styles.recentList}>
            {home.recentlyUpdated.map((page) => (
              <Link key={page.id} href={`/s/${key}/${page.id}`} className={styles.recentRow}>
                <FileText size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span className={styles.recentTitle}>{page.title}</span>
                  {page.parentTitle && <span className={styles.recentCrumb}>{page.parentTitle}</span>}
                </span>
                <span className={styles.recentMeta}>
                  {page.updatedByName && <Avatar name={page.updatedByName} size={22} />}
                  {timeAgo(page.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <aside className={shell.rail}>
        <div className={shell.railGroup}>
          <div className="t-caption">Members</div>
          {home.members.map((member) => (
            <div key={member.id} className={styles.memberRow}>
              <Avatar name={member.displayName} size={26} />
              <div style={{ minWidth: 0 }}>
                <div className={styles.memberName}>{member.displayName}</div>
                <div className={styles.memberLevel}>{LEVEL_LABEL[member.permLevel]}</div>
              </div>
            </div>
          ))}
        </div>
        <div className={shell.railGroup}>
          <div className="t-caption">Access</div>
          <Callout tone="added">
            Space baseline: {LEVEL_LABEL[home.space.defaultPermLevel]}. Page grants can only widen
            this, never reduce it.
          </Callout>
        </div>
        <Button variant="secondary" className={ui.btnSecondary}>
          Space settings
        </Button>
      </aside>
    </div>
  );
}
