"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, Bell, MessageSquare } from "lucide-react";
import type { NotificationDto } from "@angy/shared";
import { useEscape } from "../../lib/useEscape";
import { IconButton } from "../ui/IconButton";
import { timeAgo } from "../../lib/time";
import { cx } from "../../lib/cx";
import styles from "./shell.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** How often the badge refreshes while the app is open. */
const POLL_MS = 60_000;

/**
 * The bell menu (V2 H3), per frontend.pen frame 19 — the in-app inbox the
 * roadmap wanted behind mentions.
 *
 * Polled rather than pushed. The realtime tier carries *document* traffic and
 * a socket is opened per page being edited; a reader who is not editing has no
 * connection at all, so notifications would never reach the people most likely
 * to want them. A minute's latency on "someone mentioned you" is not worth a
 * second transport.
 */
export function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  useEscape(() => setOpen(false));

  const unread = items.filter((item) => !item.read).length;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/notifications`, { credentials: "include" });
        const body = await res.json();
        if (!cancelled && body.success) setItems(body.data as NotificationDto[]);
      } catch {
        // An unreachable API must not take the shell down with it; the bell
        // simply stays as it was.
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function markAllRead() {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    await fetch(`${API_URL}/notifications/read`, {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
  }

  return (
    <span className={styles.bellWrap}>
      <IconButton
        label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={15} />
      </IconButton>
      {unread > 0 && (
        <span className={styles.bellBadge} data-testid="bell-badge">
          {unread > 9 ? "9+" : unread}
        </span>
      )}

      {open && (
        <>
          <div
            className={styles.menuScrim}
            role="presentation"
            onClick={() => setOpen(false)}
          />
          <div className={styles.bellMenu} role="dialog" aria-label="Notifications">
            <div className={styles.bellHeader}>
              <span className="t-caption">Notifications</span>
              {unread > 0 && (
                <button className={styles.bellAction} onClick={() => void markAllRead()}>
                  Mark all read
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className={styles.bellEmpty}>
                Nothing yet. When someone @-mentions you or comments on a page you touched, it
                shows up here.
              </p>
            ) : (
              items.map((item) => (
                <Link
                  key={item.id}
                  href={`/s/${item.spaceKey}/${item.pageId}`}
                  className={cx(styles.bellItem, !item.read && styles.bellItemUnread)}
                  data-testid="bell-item"
                  onClick={() => {
                    setOpen(false);
                    setItems((current) =>
                      current.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
                    );
                    void fetch(`${API_URL}/notifications/${item.id}/read`, {
                      method: "POST",
                      credentials: "include",
                    }).catch(() => undefined);
                  }}
                >
                  {item.kind === "COMMENT" ? (
                    <MessageSquare size={14} className={styles.bellIcon} />
                  ) : (
                    <AtSign size={14} className={styles.bellIcon} />
                  )}
                  <span className={styles.bellText}>
                    <strong>{item.actorName ?? "Someone"}</strong>{" "}
                    {item.kind === "COMMENT" ? "commented on" : "mentioned you in"}{" "}
                    <strong>{item.pageTitle}</strong>
                    <span className={styles.bellTime}>{timeAgo(item.createdAt)}</span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </span>
  );
}
