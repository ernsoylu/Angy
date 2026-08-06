"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, X } from "lucide-react";
import type { PermLevelDto } from "@angy/shared";
import { useEscape } from "../../lib/useEscape";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { cx } from "../../lib/cx";
import share from "../share/share.module.css";
import styles from "./space-settings.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const LEVELS: { value: PermLevelDto; label: string }[] = [
  { value: "VIEW", label: "Can view" },
  { value: "EDIT", label: "Can edit" },
  { value: "FULL", label: "Full access" },
  { value: "ADMIN", label: "Admin" },
];

/** Derive a legal key from the name, so most people never touch the field. */
function suggestKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 20)
    .replace(/-+$/g, "");
}

/** Create space (frame 13). The creator becomes the space's first admin. */
export function NewSpaceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [defaultPermLevel, setDefaultPermLevel] = useState<PermLevelDto>("VIEW");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  const effectiveKey = keyTouched ? key : suggestKey(name);
  const keyValid = /^[a-z][a-z0-9-]*$/.test(effectiveKey) && effectiveKey.length >= 2;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/spaces`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: effectiveKey,
          name: name.trim(),
          description: description.trim() || null,
          visibility,
          defaultPermLevel,
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error.message);
      router.push(`/s/${body.data.key}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className={share.overlay} onClick={onClose}>
      <div
        className={share.dialog}
        role="dialog"
        aria-label="New space"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560 }}
      >
        <header className={share.header}>
          <h2 className={share.title}>New space</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        {error && <div className={share.error}>{error}</div>}

        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={share.inviteInput}
            placeholder="Engineering"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Space key</span>
          <input
            className={share.inviteInput}
            placeholder="eng"
            aria-label="Space key"
            value={effectiveKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toLowerCase());
            }}
          />
          <span className={styles.hint}>
            {effectiveKey && !keyValid
              ? "Lowercase letters, digits and hyphens; must start with a letter."
              : "Permanent — it goes into every page URL in this space. There is no rename in V1."}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Description</span>
          <input
            className={share.inviteInput}
            placeholder="What lives here?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Visibility</span>
          {(
            [
              {
                value: "PUBLIC" as const,
                title: "Public to the workspace",
                body: "Anyone signed in can read it.",
              },
              {
                value: "PRIVATE" as const,
                title: "Private",
                body: "Members only; media is served through signed URLs.",
              },
            ]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              className={cx(styles.option, visibility === option.value && styles.optionActive)}
              aria-pressed={visibility === option.value}
              onClick={() => setVisibility(option.value)}
            >
              <span className={styles.optionTitle}>{option.title}</span>
              <span className={styles.optionBody}>{option.body}</span>
            </button>
          ))}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Baseline for every member</span>
          <Select
            value={defaultPermLevel}
            onChange={(e) => setDefaultPermLevel(e.target.value as PermLevelDto)}
          >
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </Select>
        </label>

        <Callout tone="note">
          You become this space&rsquo;s first admin. Page grants can only widen the baseline,
          never reduce it.
        </Callout>

        <footer className={share.footer}>
          <span className={share.footerNote}>Opens the new space home.</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<FolderPlus size={14} />}
            disabled={busy || !name.trim() || !keyValid}
            onClick={() => void create()}
          >
            Create space
          </Button>
        </footer>
      </div>
    </div>
  );
}
