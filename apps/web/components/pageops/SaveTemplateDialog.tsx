"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useEscape } from "../../lib/useEscape";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import share from "../share/share.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Save this page's body as a reusable template (V2 H2).
 *
 * A snapshot, not a link: the copy is taken now, so later edits to this page
 * do not silently change what every future page starts from. Re-using an
 * existing name overwrites it, which is how a template gets improved — the
 * dialog says so rather than failing on a duplicate.
 */
export function SaveTemplateDialog({
  pageId,
  pageTitle,
  onClose,
}: {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(pageTitle);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/save-as-template`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error.message);
      setSaved(body.data.name as string);
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
      <div
        className={share.dialog}
        role="dialog"
        aria-label="Save as template"
        style={{ width: 460 }}
      >
        <header className={share.header}>
          <h2 className={share.title}>Save as template</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        {error && <div className={share.error}>{error}</div>}

        {saved ? (
          <p className={share.footerNote}>
            Saved as “{saved}”. It now appears in this space’s New page dialog.
          </p>
        ) : (
          <>
            <input
              className={share.inviteInput}
              placeholder="Template name..."
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void save();
              }}
              data-testid="template-name"
            />
            <input
              className={share.inviteInput}
              placeholder="What is it for? (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className={share.footerNote}>
              Copies this page’s content as it is now. An existing template with the same name
              is replaced.
            </p>
          </>
        )}

        <footer className={share.footer}>
          <span />
          <Button variant="secondary" onClick={onClose}>
            {saved ? "Done" : "Cancel"}
          </Button>
          {!saved && (
            <Button disabled={busy || !name.trim()} onClick={() => void save()}>
              Save template
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
