"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, Cpu, Folder, X } from "lucide-react";
import type { PageSummaryDto, SpaceDto } from "@angy/shared";
import { cx } from "../../lib/cx";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import share from "../share/share.module.css";
import styles from "./pageops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json();
  if (!body.success) throw new Error(body.error.message);
  return body.data as T;
}

interface Row {
  id: string | null;
  title: string;
  depth: number;
  disabled: boolean;
  isCurrent: boolean;
}

/** Move-page dialog per frontend.pen frame 10. */
export function MoveDialog({
  pageId,
  pageTitle,
  spaceKey,
  onClose,
}: {
  pageId: string;
  pageTitle: string;
  spaceKey: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummaryDto[] | null>(null);
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [destination, setDestination] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const spaces = await call<SpaceDto[]>("/spaces");
        const current = spaces.find((s) => s.key === spaceKey);
        if (!current) throw new Error("Space not found");
        setSpace(current);
        setPages(await call<PageSummaryDto[]>(`/spaces/${current.id}/pages`));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [spaceKey]);

  const { rows, childCount, currentParentId } = useMemo(() => {
    if (!pages) return { rows: [] as Row[], childCount: 0, currentParentId: null };
    const childrenOf = new Map<string | null, PageSummaryDto[]>();
    for (const page of pages) {
      const list = childrenOf.get(page.parentId) ?? [];
      list.push(page);
      childrenOf.set(page.parentId, list);
    }
    // The page's own subtree is not a legal destination.
    const subtree = new Set<string>([pageId]);
    const walk = (id: string) => {
      for (const child of childrenOf.get(id) ?? []) {
        subtree.add(child.id);
        walk(child.id);
      }
    };
    walk(pageId);
    const self = pages.find((p) => p.id === pageId);

    const rows: Row[] = [];
    const emit = (parentId: string | null, depth: number) => {
      for (const page of childrenOf.get(parentId) ?? []) {
        rows.push({
          id: page.id,
          title: page.title,
          depth,
          disabled: subtree.has(page.id),
          isCurrent: page.id === self?.parentId,
        });
        emit(page.id, depth + 1);
      }
    };
    emit(null, 1);
    return {
      rows,
      childCount: subtree.size - 1,
      currentParentId: self?.parentId ?? null,
    };
  }, [pages, pageId]);

  async function move() {
    if (destination === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/pages/${pageId}/move`, {
        method: "POST",
        body: JSON.stringify({ parentId: destination }),
      });
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const destinationTitle =
    destination === null
      ? space?.name
      : rows.find((r) => r.id === destination)?.title;

  return (
    <div className={share.overlay} onClick={onClose}>
      <div className={share.dialog} role="dialog" aria-label="Move page" onClick={(e) => e.stopPropagation()}>
        <header className={share.header}>
          <div>
            <h2 className={share.title}>Move page</h2>
            <div className={styles.subtitle}>
              {pageTitle} · {childCount} child page{childCount === 1 ? "" : "s"}
            </div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        {error && <div className={share.error}>{error}</div>}

        <div className="t-caption">Move to</div>
        <div className={styles.tree}>
          <button
            className={cx(
              styles.treeRow,
              destination === null && styles.treeRowSelected,
              currentParentId === null && styles.treeRowDisabled,
            )}
            disabled={currentParentId === null}
            onClick={() => setDestination(null)}
          >
            <Cpu size={15} />
            {space?.name ?? "Space root"}
            {currentParentId === null && <Badge hue="neutral">current</Badge>}
            {destination === null && <Badge hue="accent">destination</Badge>}
          </button>
          {rows.map((row) => (
            <button
              key={row.id}
              className={cx(
                styles.treeRow,
                destination === row.id && styles.treeRowSelected,
                (row.disabled || row.isCurrent) && styles.treeRowDisabled,
              )}
              style={{ paddingLeft: 12 + row.depth * 22 }}
              disabled={row.disabled || row.isCurrent}
              onClick={() => setDestination(row.id)}
            >
              <Folder size={15} />
              {row.title}
              {row.isCurrent && <Badge hue="neutral">current</Badge>}
              {destination === row.id && <Badge hue="accent">destination</Badge>}
            </button>
          ))}
        </div>

        <div className={share.warning}>
          Moving rewrites the page tree for this page and its {childCount} child
          {childCount === 1 ? "" : "ren"}, and re-evaluates their permissions from the new parent.
          Links to the page keep working.
        </div>

        <footer className={share.footer}>
          <span className={share.footerNote}>
            {space?.name}
            {destination !== undefined && destinationTitle && destination !== null
              ? ` › ${destinationTitle}`
              : ""}{" "}
            › {pageTitle}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<CornerDownRight size={14} />}
            disabled={busy || destination === undefined}
            onClick={() => void move()}
          >
            Move here
          </Button>
        </footer>
      </div>
    </div>
  );
}
