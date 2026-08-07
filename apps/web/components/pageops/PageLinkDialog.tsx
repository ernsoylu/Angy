"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, X } from "lucide-react";
import type { PageDetailDto, PageSummaryDto } from "@angy/shared";
import { useEscape } from "../../lib/useEscape";
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

export interface LinkedPage {
  id: string;
  title: string;
}

/**
 * The `/page` destination picker: link an existing page, or create a named one.
 *
 * Both halves are here rather than in two commands because they answer the same
 * question — "which page does this refer to?" — and the answer is usually "one
 * that already exists". Creating was the only option at first, which made the
 * common case impossible and the rare case produce a page called Untitled.
 *
 * Naming up front also works around a real constraint: the link node is an atom
 * carrying a cached title, so the label cannot be edited in place. The page's
 * real title lives in its own Y.Doc (hard rule 4), and letting the parent
 * document write it would create a second source of truth for a value
 * `onStoreDocument` already owns.
 */
export function PageLinkDialog({
  pageId,
  onPick,
  onClose,
}: {
  /** The page being edited — the parent for anything created here. */
  pageId: string;
  onPick: (page: LinkedPage) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<PageSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await call<PageDetailDto>(`/pages/${pageId}`);
        const list = await call<PageSummaryDto[]>(`/spaces/${page.spaceId}/pages`);
        // Linking a page to itself is a loop with no meaning; drop it rather
        // than let someone pick it and wonder why nothing happens.
        if (!cancelled) setPages(list.filter((p) => p.id !== pageId));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const matches = useMemo(() => {
    if (!pages) return [];
    const q = query.trim().toLowerCase();
    if (!q) return pages.slice(0, 12);
    return pages.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 12);
  }, [pages, query]);

  // Offer creation only when the typed name is not already an exact title —
  // otherwise the obvious action would be "make a second page with this name".
  const exact = matches.some((p) => p.title.toLowerCase() === query.trim().toLowerCase());
  const canCreate = query.trim().length > 0 && !exact;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await call<{ id: string; title: string }>(`/pages/${pageId}/children`, {
        method: "POST",
        body: JSON.stringify({ title: query.trim() }),
      });
      onPick({ id: created.id, title: created.title });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className={share.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={share.dialog} role="dialog" aria-label="Link a page" style={{ width: 520 }}>
        <header className={share.header}>
          <h2 className={share.title}>Link a page</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        {error && <div className={share.error}>{error}</div>}

        <input
          className={share.inviteInput}
          placeholder="Search pages, or type a name to create one..."
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />

        {canCreate && (
          <Button icon={<Plus size={14} />} disabled={busy} onClick={() => void create()}>
            {busy ? "Creating..." : `Create "${query.trim()}" as a child page`}
          </Button>
        )}

        <div className={styles.tree}>
          {pages === null && !error && <div className={styles.noMatches}>Loading pages...</div>}
          {pages !== null && matches.length === 0 && (
            <div className={styles.noMatches}>
              {query.trim() ? "No page matches that name." : "This space has no other pages yet."}
            </div>
          )}
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.treeRow}
              onClick={() => onPick({ id: p.id, title: p.title })}
            >
              <FileText size={14} />
              <span>{p.title}</span>
            </button>
          ))}
        </div>

        <footer className={share.footer}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </footer>
      </div>
    </div>
  );
}
