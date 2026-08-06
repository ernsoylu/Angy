"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Merge, Pencil } from "lucide-react";
import type { TagDto } from "@angy/shared";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useToast } from "../ui/ToastProvider";
import styles from "./space-settings.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Tag cleanup — the other half of freeform tagging. Tags are workspace-wide,
 * so both operations require admin on *every* space a tag appears in; the API
 * enforces that and this surface just reports the refusal plainly.
 *
 * It lives in space settings because that is the only admin surface there is,
 * not because tags belong to a space.
 */
export function TagAdmin() {
  const [tags, setTags] = useState<TagDto[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function load() {
    const res = await fetch(`${API_URL}/tags`, { credentials: "include" });
    const body = await res.json();
    if (body.success) setTags(body.data as TagDto[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(path: string, payload: unknown, success: string) {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.success) {
        toast("error", "Tag unchanged", body.error.message);
        return;
      }
      toast("success", success, "Every page carrying it was re-indexed.");
      setEditing(null);
      setMergeInto("");
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className="t-caption">Tags</div>
      <Callout tone="note">
        Tags are shared across every space. Renaming or merging one needs admin on all of them —
        anything looser would let one space rewrite a label another depends on.
      </Callout>

      {tags.length === 0 ? (
        <p className={styles.hint}>No tags yet. They appear as soon as someone adds one.</p>
      ) : (
        <div className={styles.memberList}>
          {tags.map((tag) => (
            <div key={tag.id} className={styles.memberRow} data-testid={`tag-row-${tag.name}`}>
              {editing === tag.id ? (
                <>
                  <Input
                    aria-label={`New name for ${tag.name}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <Select
                    aria-label={`Merge ${tag.name} into`}
                    value={mergeInto}
                    onChange={(e) => setMergeInto(e.target.value)}
                  >
                    <option value="">Rename only</option>
                    {tags
                      .filter((other) => other.id !== tag.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          Merge into {other.name}
                        </option>
                      ))}
                  </Select>
                  <Button
                    small
                    disabled={busy}
                    onClick={() =>
                      void (mergeInto
                        ? act(`/tags/${tag.id}/merge`, { intoId: mergeInto }, "Tags merged")
                        : act(`/tags/${tag.id}/rename`, { name: draft }, "Tag renamed"))
                    }
                  >
                    Apply
                  </Button>
                  <Button small variant="secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className={styles.memberName}>{tag.name}</span>
                    <span className={styles.memberEmail}>
                      {tag.pageCount} page{tag.pageCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <Button
                    small
                    variant="secondary"
                    icon={<Pencil size={13} />}
                    onClick={() => {
                      setEditing(tag.id);
                      setDraft(tag.name);
                      setMergeInto("");
                    }}
                  >
                    Rename
                  </Button>
                  <Merge size={14} style={{ color: "var(--text-3)" }} aria-hidden />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
