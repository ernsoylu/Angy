"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, Cpu, Folder, X } from "lucide-react";
import type { PageSummaryDto, SpaceDto } from "@angy/shared";
import { cx } from "../../lib/cx";
import { useEscape } from "../../lib/useEscape";
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

interface Destination {
  spaceId: string;
  parentId: string | null;
}

interface Row {
  kind: "space" | "page";
  spaceId: string;
  id: string | null;
  title: string;
  depth: number;
  disabled: boolean;
  isCurrent: boolean;
}

/** Move-page dialog per frontend.pen frame 10 — destinations span all spaces. */
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
  const [spaces, setSpaces] = useState<SpaceDto[] | null>(null);
  const [pagesBySpace, setPagesBySpace] = useState<Map<string, PageSummaryDto[]>>(new Map());
  const [destination, setDestination] = useState<Destination | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  useEscape(onClose);

  useEffect(() => {
    void (async () => {
      try {
        const all = await call<SpaceDto[]>("/spaces");
        setSpaces(all);
        const entries = await Promise.all(
          all.map(async (space) => {
            const pages = await call<PageSummaryDto[]>(`/spaces/${space.id}/pages`).catch(
              () => [] as PageSummaryDto[],
            );
            return [space.id, pages] as const;
          }),
        );
        setPagesBySpace(new Map(entries));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const { rows, childCount, currentSpaceId, currentParentId } = useMemo(() => {
    if (!spaces) return { rows: [] as Row[], childCount: 0, currentSpaceId: "", currentParentId: null };
    let childCount = 0;
    let currentSpaceId = "";
    let currentParentId: string | null = null;
    const rows: Row[] = [];

    for (const space of spaces) {
      const pages = pagesBySpace.get(space.id) ?? [];
      const childrenOf = new Map<string | null, PageSummaryDto[]>();
      for (const page of pages) {
        const list = childrenOf.get(page.parentId) ?? [];
        list.push(page);
        childrenOf.set(page.parentId, list);
      }
      const self = pages.find((p) => p.id === pageId);
      // The page's own subtree is never a legal destination.
      const subtree = new Set<string>();
      if (self) {
        currentSpaceId = space.id;
        currentParentId = self.parentId;
        subtree.add(pageId);
        const walk = (id: string) => {
          for (const child of childrenOf.get(id) ?? []) {
            subtree.add(child.id);
            walk(child.id);
          }
        };
        walk(pageId);
        childCount = subtree.size - 1;
      }

      rows.push({
        kind: "space",
        spaceId: space.id,
        id: null,
        title: space.name,
        depth: 0,
        disabled: false,
        isCurrent: Boolean(self && self.parentId === null),
      });
      const emit = (parentId: string | null, depth: number) => {
        for (const page of childrenOf.get(parentId) ?? []) {
          rows.push({
            kind: "page",
            spaceId: space.id,
            id: page.id,
            title: page.title,
            depth,
            disabled: subtree.has(page.id),
            isCurrent: Boolean(self && page.id === self.parentId),
          });
          emit(page.id, depth + 1);
        }
      };
      emit(null, 1);
    }
    return { rows, childCount, currentSpaceId, currentParentId };
  }, [spaces, pagesBySpace, pageId]);

  async function move() {
    if (destination === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/pages/${pageId}/move`, {
        method: "POST",
        body: JSON.stringify({ parentId: destination.parentId, spaceId: destination.spaceId }),
      });
      const targetSpace = spaces?.find((s) => s.id === destination.spaceId);
      const key = targetSpace?.key ?? spaceKey;
      router.push(`/s/${key}/${pageId}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const isSelected = (row: Row) =>
    destination !== undefined &&
    destination.spaceId === row.spaceId &&
    destination.parentId === row.id;

  const destinationRow = rows.find(isSelected);

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

        <input
          className={share.inviteInput}
          placeholder="Search spaces and pages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="t-caption">Move to</div>
        <div className={styles.tree}>
          {rows
            .filter(
              (row) =>
                !query.trim() ||
                row.title.toLowerCase().includes(query.trim().toLowerCase()) ||
                row.kind === "space",
            )
            .map((row) => (
            <button
              key={`${row.spaceId}:${row.id ?? "root"}`}
              className={cx(
                styles.treeRow,
                isSelected(row) && styles.treeRowSelected,
                (row.disabled || row.isCurrent) && styles.treeRowDisabled,
              )}
              style={{ paddingLeft: 12 + row.depth * 22 }}
              disabled={row.disabled || row.isCurrent}
              onClick={() => setDestination({ spaceId: row.spaceId, parentId: row.id })}
            >
              {row.kind === "space" ? <Cpu size={15} /> : <Folder size={15} />}
              {row.title}
              {row.isCurrent && <Badge hue="neutral">current</Badge>}
              {isSelected(row) && <Badge hue="accent">destination</Badge>}
            </button>
            ))}
        </div>

        <div className={share.warning}>
          Moving rewrites the page tree for this page and its {childCount} child
          {childCount === 1 ? "" : "ren"}, and re-evaluates their permissions from the new parent.
          Moving between spaces of different visibility re-issues media URLs. Links to the page
          keep working.
        </div>

        <footer className={share.footer}>
          <span className={share.footerNote}>
            {destinationRow
              ? `${spaces?.find((s) => s.id === destinationRow.spaceId)?.name}${
                  destinationRow.kind === "page" ? ` › ${destinationRow.title}` : ""
                } › ${pageTitle}`
              : `${spaces?.find((s) => s.id === currentSpaceId)?.name ?? ""} › ${pageTitle}`}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<CornerDownRight size={14} />}
            disabled={
              busy ||
              destination === undefined ||
              (destination.spaceId === currentSpaceId && destination.parentId === currentParentId)
            }
            onClick={() => void move()}
          >
            Move here
          </Button>
        </footer>
      </div>
    </div>
  );
}
