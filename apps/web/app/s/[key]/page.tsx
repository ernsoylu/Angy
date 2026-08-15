import Link from "next/link";
import { notFound } from "next/navigation";
import { Cpu, FileText } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { NewPageButton } from "../../../components/pageops/NewPageButton";
import { SpaceSettingsButton } from "../../../components/spaces/SpaceSettingsDialog";
import { EmptyState } from "../../../components/ui/SystemState";
import { getSpaceByKey, getSpaceHome, getSpaceMembers } from "../../../lib/api";
import { formatBytes, timeAgo } from "../../../lib/time";
import styles from "./space-home.module.css";

/**
 * Space home per frontend.pen frame 5.
 *
 * No right rail: members and access moved into the Settings dialog beside New
 * page (frame 13), and creating a space is a top-bar action now. What is left
 * is the space's own content, so it takes the whole width the browser offers
 * rather than a fixed column with an empty gutter beside it.
 */
export default async function SpaceHomePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const [home, members] = await Promise.all([getSpaceHome(space.id), getSpaceMembers(space.id)]);

  return (
    <div className={styles.wrap}>
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
        <div className={styles.headerActions}>
          {/* Members and access, one click from where they used to sit. */}
          <SpaceSettingsButton space={home.space} members={members} />
          {/* The sidebar's New page button owns the dialog; this one is the
              same action reached from the space header. */}
          <NewPageButton spaceId={space.id} spaceKey={key} spaceName={home.space.name} />
        </div>
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
        <EmptyState
          action={
            <NewPageButton
              spaceId={space.id}
              spaceKey={key}
              spaceName={home.space.name}
              label="Create the first page"
            />
          }
        />
      ) : (
        <div className={styles.recentList} data-testid="recent-list">
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
  );
}
