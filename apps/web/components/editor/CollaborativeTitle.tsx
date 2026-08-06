"use client";

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { applyTextDiff, TITLE_FIELD } from "@angy/blocks";

/**
 * The page title as a collaborative Y.Text in the page's own Y.Doc (Wave F).
 * Two editors typing in the title converge the same way they do in the body,
 * and the row in Postgres is written by the realtime store — never from here.
 */
export function CollaborativeTitle({
  ydoc,
  synced,
  fallback,
  onChange,
}: {
  ydoc: Y.Doc;
  /**
   * Until the provider has synced, the Y.Text is empty for a reason that looks
   * identical to "the title was deleted". Typing into it then would race the
   * server's one-time seed and land the title twice, so the pre-sync render is
   * the server-known title as plain text.
   */
  synced: boolean;
  fallback: string;
  onChange?: (title: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => ydoc.getText(TITLE_FIELD).toString());

  useEffect(() => {
    const text = ydoc.getText(TITLE_FIELD);
    const sync = () => {
      const next = text.toString();
      const el = input.current;
      // A remote edit rewrites the DOM value; keep the caret where the typist
      // left it rather than letting it snap to the end.
      const caret = el && document.activeElement === el ? el.selectionStart : null;
      setValue(next);
      onChange?.(next);
      if (el && caret !== null) {
        queueMicrotask(() => {
          const at = Math.min(caret, next.length);
          el.setSelectionRange(at, at);
        });
      }
    };
    text.observe(sync);
    sync();
    return () => text.unobserve(sync);
  }, [ydoc, onChange]);

  if (!synced) {
    return (
      <div className="t-title" style={{ marginBottom: 18 }}>
        {fallback}
      </div>
    );
  }

  return (
    <input
      ref={input}
      className="t-title"
      aria-label="Page title"
      value={value}
      onChange={(event) => {
        // Y.Text is the source of truth; the observer above sets local state.
        applyTextDiff(ydoc.getText(TITLE_FIELD), event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
      }}
      style={{
        width: "100%",
        border: "none",
        background: "transparent",
        outline: "none",
        color: "var(--text)",
        marginBottom: 18,
      }}
    />
  );
}
