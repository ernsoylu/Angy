"use client";

import Link from "next/link";
import { FileText, History, LogOut, Star } from "lucide-react";
import type { PageListItemDto } from "@angy/shared";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { timeAgo } from "../../lib/time";
import styles from "./me.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface MeViewProps {
  user: { name: string; email: string };
  spaceKey: string;
  recent: PageListItemDto[];
  starred: PageListItemDto[];
}

function Section({
  icon,
  title,
  href,
  items,
  spaceKey,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  href: string;
  items: PageListItemDto[];
  spaceKey: string;
  empty: string;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>
          {icon} {title}
        </span>
        <Link href={href} className={styles.seeAll}>
          See all
        </Link>
      </div>
      {items.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <div className={styles.list}>
          {items.slice(0, 5).map((item) => (
            <Link key={item.id} href={`/s/${spaceKey}/${item.id}`} className={styles.row}>
              <FileText size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
              <span className={styles.rowTitle}>{item.title}</span>
              <span className={styles.rowTime}>{timeAgo(item.at)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The mobile tab bar's "Me" screen (frame E): who you are, your two personal
 * lists, and sign-out — the account menu lives in the top bar, which is hidden
 * at this breakpoint.
 */
export function MeView({ user, spaceKey, recent, starred }: MeViewProps) {
  async function signOut() {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    window.location.assign("/signin");
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.profile}>
        {/* 30 is the top of frame C's avatar scale — no new size invented for
            a screen the design file doesn't specify. */}
        <Avatar name={user.name} size={30} />
        <div style={{ minWidth: 0 }}>
          <div className={styles.name}>{user.name}</div>
          <div className={styles.email}>{user.email}</div>
        </div>
      </header>

      <Section
        icon={<History size={14} />}
        title="Recent"
        href={`/s/${spaceKey}/recent`}
        items={recent}
        spaceKey={spaceKey}
        empty="Pages you read show up here."
      />
      <Section
        icon={<Star size={14} />}
        title="Starred"
        href={`/s/${spaceKey}/starred`}
        items={starred}
        spaceKey={spaceKey}
        empty="Star a page from its info rail to keep it here."
      />

      <Button
        variant="secondary"
        icon={<LogOut size={14} />}
        style={{ width: "100%" }}
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </div>
  );
}
