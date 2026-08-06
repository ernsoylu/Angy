"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, History, Trash2 } from "lucide-react";
import type { TrashItemDto } from "@angy/shared";
import { cx } from "../../lib/cx";
import { timeAgo } from "../../lib/time";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { IconButton } from "../ui/IconButton";
import { EmptyState } from "../ui/SystemState";
import { useToast } from "../ui/ToastProvider";
import styles from "./trash.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

/** Trash & restore per frontend.pen frame 9. */
export function TrashView({ initial, spaceKey }: { initial: TrashItemDto[]; spaceKey: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const [query, setQuery] = useState("");

  // "Search trash" (frame 9) covers the whole row, not just the title: you are
  // usually hunting by where something was or who trashed it.
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) =>
        [item.title, item.parentTitle, item.spaceName, item.trashedByName]
          .some((field) => field?.toLowerCase().includes(needle)),
      )
    : items;

  async function act(path: string, removeId: string) {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}${path}`, { method: "POST", credentials: "include" });
      const body = await res.json();
      if (body.success) {
        setItems((prev) => prev.filter((i) => i.id !== removeId));
        router.refresh();
        toast(
          "success",
          path.endsWith("/restore") ? "Page restored" : "Deleted permanently",
          path.endsWith("/restore")
            ? "Its children and place in the tree came back with it."
            : undefined,
        );
      } else {
        toast("error", "Action failed", body.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function emptyTrash() {
    setBusy(true);
    try {
      for (const item of items) {
        await fetch(`${API_URL}/pages/${item.id}/hard-delete`, {
          method: "POST",
          credentials: "include",
        });
      }
      setItems([]);
      router.refresh();
      toast("success", "Trash emptied");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className="t-title" style={{ fontSize: 32 }}>
            Trash
          </h1>
          <p className={styles.subtitle}>
            {items.length} item{items.length === 1 ? "" : "s"} · restoring a page also restores its
            children and its place in the tree
          </p>
        </div>
        <input
          className={styles.search}
          placeholder="Search trash"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          disabled={busy || items.length === 0}
          onClick={() => void emptyTrash()}
        >
          Empty trash
        </Button>
      </header>

      <Callout tone="hardRule">
        Items are deleted permanently 30 days after they are trashed. Attachments are swept a few
        hours later.
      </Callout>

      {items.length === 0 ? (
        <EmptyState
          title="Trash is empty"
          body="Pages you move to the trash wait here for 30 days before they are deleted permanently."
          actionLabel="Back to space"
          onAction={() => router.push(`/s/${spaceKey}`)}
        />
      ) : (
        <div className={styles.table}>
          <div className={cx(styles.row, styles.head)}>
            <span>Page</span>
            <span>Space</span>
            <span>Trashed by</span>
            <span>Deleted in</span>
            <span>Actions</span>
          </div>
          {visible.length === 0 && (
            <p className={styles.noMatches}>Nothing in the trash matches “{query.trim()}”.</p>
          )}
          {visible.map((item, index) => {
            const days = daysLeft(item.hardDeleteAt);
            return (
              <div key={item.id} className={styles.row}>
                <span className={styles.pageCell}>
                  <FileText size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <span className={styles.pageTitle}>{item.title}</span>
                    {item.parentTitle && (
                      <span className={styles.pageCrumb}>was in {item.parentTitle}</span>
                    )}
                  </span>
                </span>
                <span className={styles.cell}>{item.spaceName}</span>
                <span className={cx(styles.cell, styles.person)}>
                  {item.trashedByName && <Avatar name={item.trashedByName} size={22} />}
                  {item.trashedByName ?? "Unknown"} · {timeAgo(item.deletedAt)}
                </span>
                <span className={styles.cell}>
                  <span className={cx(styles.days, days <= 7 && styles.daysUrgent)}>
                    {days} day{days === 1 ? "" : "s"}
                  </span>
                </span>
                <span className={styles.actions}>
                  <Button
                    variant={index === 0 ? "primary" : "secondary"}
                    small
                    icon={<History size={13} />}
                    disabled={busy}
                    onClick={() => void act(`/pages/${item.id}/restore`, item.id)}
                  >
                    Restore
                  </Button>
                  <IconButton
                    label={`Delete ${item.title} permanently`}
                    disabled={busy}
                    onClick={() => void act(`/pages/${item.id}/hard-delete`, item.id)}
                  >
                    <Trash2 size={14} style={{ color: "var(--clay)" }} />
                  </IconButton>
                </span>
              </div>
            );
            })}
        </div>
      )}
    </div>
  );
}
