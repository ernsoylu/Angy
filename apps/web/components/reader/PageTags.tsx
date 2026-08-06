"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { normalizeTag, type TagDto } from "@angy/shared";
import { cx } from "../../lib/cx";
import { useToast } from "../ui/ToastProvider";
import styles from "./tags.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** The four pastel hues from frame A, picked deterministically so a tag keeps
 *  the same colour everywhere it appears. */
const HUES = ["accent", "lilac", "sage", "amber", "clay"] as const;

function hueFor(name: string): (typeof HUES)[number] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % HUES.length;
  return HUES[h]!;
}

interface PageTagsProps {
  pageId: string;
  spaceKey: string;
  initial: string[];
  canEdit: boolean;
}

/**
 * Tag chips on the reader byline (frame 1). Freeform: anyone with EDIT coins a
 * tag by typing it. Chips link into search pre-filtered by that tag.
 */
export function PageTags({ pageId, spaceKey, initial, canEdit }: PageTagsProps) {
  const [tags, setTags] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<TagDto[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  // Typeahead over the workspace-wide vocabulary — freeform authoring still
  // benefits from seeing what already exists.
  useEffect(() => {
    if (!editing) return;
    const handle = setTimeout(() => {
      void fetch(`${API_URL}/tags?q=${encodeURIComponent(draft)}`, { credentials: "include" })
        .then((res) => res.json())
        .then((body) => {
          if (body.success) setSuggestions(body.data as TagDto[]);
        })
        .catch(() => undefined);
    }, 150);
    return () => clearTimeout(handle);
  }, [draft, editing]);

  async function save(next: string[]) {
    const previous = tags;
    setTags(next);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/tags`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      const body = await res.json();
      if (!body.success) {
        setTags(previous);
        toast("error", "Could not save tags", body.error.message);
        return;
      }
      setTags((body.data as TagDto[]).map((t) => t.name));
      router.refresh();
    } catch {
      setTags(previous);
      toast("error", "Network error", "Your tags were not saved.");
    } finally {
      setBusy(false);
    }
  }

  function add(raw: string) {
    const name = normalizeTag(raw);
    setDraft("");
    if (!name || tags.includes(name)) return;
    void save([...tags, name]);
  }

  if (tags.length === 0 && !canEdit) return null;

  return (
    <span className={styles.tags}>
      {tags.map((name) => (
        <span key={name} className={styles.chipWrap}>
          <Link
            href={`/s/${spaceKey}/search?q=${encodeURIComponent(name)}&tags=${encodeURIComponent(name)}`}
            className={cx(styles.chip, styles[hueFor(name)])}
          >
            {name}
          </Link>
          {editing && (
            <button
              type="button"
              aria-label={`Remove tag ${name}`}
              className={styles.remove}
              disabled={busy}
              onClick={() => void save(tags.filter((t) => t !== name))}
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}

      {canEdit && !editing && (
        <button
          type="button"
          className={styles.addBtn}
          aria-label="Edit tags"
          onClick={() => setEditing(true)}
        >
          <Plus size={12} />
          {tags.length === 0 && "Add tags"}
        </button>
      )}

      {editing && (
        <span className={styles.editor}>
          <input
            ref={input}
            className={styles.input}
            aria-label="Add a tag"
            placeholder="tag name…"
            value={draft}
            list="tag-suggestions"
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(draft);
              }
              if (event.key === "Escape") {
                setDraft("");
                setEditing(false);
              }
            }}
            onBlur={() => {
              // Let a click on a suggestion land before the field closes.
              setTimeout(() => setEditing(false), 150);
            }}
          />
          <datalist id="tag-suggestions">
            {suggestions
              .filter((s) => !tags.includes(s.name))
              .map((s) => (
                <option key={s.id} value={s.name}>
                  {s.pageCount} page{s.pageCount === 1 ? "" : "s"}
                </option>
              ))}
          </datalist>
        </span>
      )}
    </span>
  );
}
