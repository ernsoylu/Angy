"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Trash2, UserPlus, X } from "lucide-react";
import type { PermLevelDto, SpaceDto, SpaceMemberDto } from "@angy/shared";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Tag } from "../ui/Tag";
import { useToast } from "../ui/ToastProvider";
import { TagAdmin } from "./TagAdmin";
import { cx } from "../../lib/cx";
import styles from "./space-settings.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const LEVELS: { value: PermLevelDto; label: string }[] = [
  { value: "VIEW", label: "Can view" },
  { value: "EDIT", label: "Can edit" },
  { value: "FULL", label: "Full access" },
  { value: "ADMIN", label: "Admin" },
];

interface SpaceSettingsViewProps {
  space: SpaceDto;
  members: SpaceMemberDto[];
  pageCount: number;
}

/**
 * Space settings (frame 12).
 *
 * Two save models on one screen, deliberately: identity and access are staged
 * behind Save because they are a coherent edit you might abandon, while member
 * changes apply on click. A membership change already invalidates permissions
 * server-side the moment it lands, so pretending it was pending would be a lie
 * about what the system has already done.
 */
export function SpaceSettingsView({ space, members, pageCount }: SpaceSettingsViewProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [draft, setDraft] = useState({
    name: space.name,
    description: space.description ?? "",
    visibility: space.visibility,
    defaultPermLevel: space.defaultPermLevel,
  });
  const [saving, setSaving] = useState(false);
  const [roster, setRoster] = useState(members);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLevel, setInviteLevel] = useState<PermLevelDto>("VIEW");
  const [busy, setBusy] = useState(false);

  const dirty =
    draft.name !== space.name ||
    draft.description !== (space.description ?? "") ||
    draft.visibility !== space.visibility ||
    draft.defaultPermLevel !== space.defaultPermLevel;

  async function call(path: string, init: RequestInit): Promise<{ ok: boolean; data?: unknown }> {
    const res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const body = await res.json();
    if (!body.success) {
      toast("error", "That didn't work", body.error.message);
      return { ok: false };
    }
    return { ok: true, data: body.data };
  }

  async function save() {
    setSaving(true);
    const result = await call(`/spaces/${space.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: draft.name,
        description: draft.description || null,
        visibility: draft.visibility,
        defaultPermLevel: draft.defaultPermLevel,
      }),
    });
    setSaving(false);
    if (result.ok) {
      toast("success", "Space updated", "Changes apply to everyone immediately.");
      router.refresh();
    }
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    const result = await call(`/spaces/${space.id}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: inviteEmail.trim(), permLevel: inviteLevel }),
    });
    setBusy(false);
    if (result.ok) {
      const member = result.data as SpaceMemberDto;
      setRoster((prev) => [...prev.filter((m) => m.userId !== member.userId), member]);
      setInviteEmail("");
      toast("success", `${member.displayName} added`, "Their access applies right away.");
    }
  }

  async function changeLevel(member: SpaceMemberDto, permLevel: PermLevelDto) {
    setBusy(true);
    const result = await call(`/spaces/${space.id}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: member.email, permLevel }),
    });
    setBusy(false);
    if (result.ok) {
      setRoster((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, permLevel } : m)));
    }
  }

  async function remove(member: SpaceMemberDto) {
    setBusy(true);
    const result = await call(`/spaces/${space.id}/members/${member.userId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (result.ok) {
      setRoster((prev) => prev.filter((m) => m.userId !== member.userId));
      toast("success", `${member.displayName} removed`, "They lost access to every page here.");
    }
  }

  async function trashSpace() {
    setBusy(true);
    const result = await call(`/spaces/${space.id}`, { method: "DELETE" });
    setBusy(false);
    if (result.ok) window.location.assign("/");
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 className={styles.title}>Space settings</h1>
          <p className={styles.meta}>
            {space.name} · key {space.key.toUpperCase()} · {pageCount} page
            {pageCount === 1 ? "" : "s"} · {roster.length} member
            {roster.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            disabled={!dirty || saving}
            onClick={() =>
              setDraft({
                name: space.name,
                description: space.description ?? "",
                visibility: space.visibility,
                defaultPermLevel: space.defaultPermLevel,
              })
            }
          >
            Discard
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>

      <div className={styles.columns}>
        <section className={styles.card}>
          <div className="t-caption">Identity</div>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Space key</span>
            <span className={styles.lockedField}>
              <Lock size={13} />
              {space.key}
            </span>
            <span className={styles.hint}>
              Permanent. The key is in every page URL, the search tenant filter, and the
              permission-cache prefix — V1 has no rename.
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Description</span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
        </section>

        <section className={styles.card}>
          <div className="t-caption">Visibility &amp; access</div>
          {[
            {
              value: "PUBLIC" as const,
              title: "Public to the workspace",
              body: "Anyone signed in can read it. Media is served from immutable CDN URLs.",
            },
            {
              value: "PRIVATE" as const,
              title: "Private",
              body: "Members only. Media is served through short-lived signed URLs (ADR 0007).",
            },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={cx(
                styles.option,
                draft.visibility === option.value && styles.optionActive,
              )}
              aria-pressed={draft.visibility === option.value}
              onClick={() => setDraft({ ...draft, visibility: option.value })}
            >
              <span className={styles.optionTitle}>{option.title}</span>
              <span className={styles.optionBody}>{option.body}</span>
            </button>
          ))}

          <label className={styles.field}>
            <span className={styles.label}>Baseline for every member</span>
            <Select
              value={draft.defaultPermLevel}
              onChange={(e) =>
                setDraft({ ...draft, defaultPermLevel: e.target.value as PermLevelDto })
              }
            >
              {LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </Select>
          </label>
          <Callout tone="hardRule">
            Page grants can only widen this baseline, never reduce it. Changing it clears the cached
            permissions for all {pageCount} page{pageCount === 1 ? "" : "s"}.
          </Callout>
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <span className="t-caption">Members</span>
          <Tag hue="amber">Changes apply immediately</Tag>
        </div>

        <div className={styles.inviteRow}>
          <Input
            placeholder="name@company.com"
            aria-label="Invite by email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <Select
            aria-label="Invite level"
            value={inviteLevel}
            onChange={(e) => setInviteLevel(e.target.value as PermLevelDto)}
          >
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </Select>
          <Button icon={<UserPlus size={14} />} disabled={busy} onClick={() => void invite()}>
            Invite
          </Button>
        </div>

        <div className={styles.memberList}>
          {roster.map((member) => (
            <div key={member.userId} className={styles.memberRow}>
              <Avatar name={member.displayName} size={30} />
              <span style={{ minWidth: 0 }}>
                <span className={styles.memberName}>{member.displayName}</span>
                <span className={styles.memberEmail}>{member.email}</span>
              </span>
              <Select
                aria-label={`Level for ${member.displayName}`}
                value={member.permLevel}
                disabled={busy}
                onChange={(e) => void changeLevel(member, e.target.value as PermLevelDto)}
              >
                {LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                aria-label={`Remove ${member.displayName}`}
                className={styles.removeBtn}
                disabled={busy}
                onClick={() => void remove(member)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <TagAdmin />

      <section className={cx(styles.card, styles.danger)}>
        <div className="t-caption">Danger zone</div>
        <div className={styles.dangerRow}>
          <span>
            <span className={styles.dangerTitle}>Move this space to the trash</span>
            <span className={styles.dangerBody}>
              The space and its {pageCount} page{pageCount === 1 ? "" : "s"} become recoverable for
              30 days, then are deleted permanently. Search and cached permissions drop immediately.
            </span>
          </span>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={() => void trashSpace()}
          >
            Move to trash
          </Button>
        </div>
      </section>
    </div>
  );
}
