"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Lock, UserPlus, X } from "lucide-react";
import type { PagePermissionsDto } from "@angy/shared";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import styles from "./share.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const LEVEL_LABEL: Record<string, string> = {
  VIEW: "Can view",
  EDIT: "Can edit",
  FULL: "Full access",
  ADMIN: "Admin",
};

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

/** Share & permissions dialog per frontend.pen frame 7. */
export function ShareDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [data, setData] = useState<PagePermissionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLevel, setInviteLevel] = useState("EDIT");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    call<PagePermissionsDto>(`/pages/${pageId}/permissions`)
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message));
  }, [pageId]);

  useEffect(reload, [reload]);

  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Share"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Share</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        <div className={styles.inviteRow}>
          <input
            className={styles.inviteInput}
            placeholder="Add people by email..."
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            type="email"
          />
          <Select value={inviteLevel} onChange={(e) => setInviteLevel(e.target.value)}>
            <option value="VIEW">Can view</option>
            <option value="EDIT">Can edit</option>
            <option value="FULL">Full access</option>
          </Select>
          <Button
            icon={<UserPlus size={14} />}
            disabled={busy || !inviteEmail.includes("@")}
            onClick={() =>
              mutate(async () => {
                await call(`/pages/${pageId}/permissions`, {
                  method: "POST",
                  body: JSON.stringify({ email: inviteEmail, level: inviteLevel }),
                });
                setInviteEmail("");
              })
            }
          >
            Invite
          </Button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {data && (
          <>
            <div className="t-caption">Inherited from space</div>
            <div className={styles.row}>
              <span className={styles.spaceIcon}>
                <Cpu size={15} />
              </span>
              <div className={styles.rowText}>
                <div className={styles.rowName}>Everyone in {data.space.name}</div>
                <div className={styles.rowMeta}>
                  {data.space.memberCount} members · space baseline
                </div>
              </div>
              <span className={styles.rowLevel}>
                {data.space.visibility === "PRIVATE"
                  ? "Members only"
                  : LEVEL_LABEL[data.space.baseline]}{" "}
                <Lock size={13} />
              </span>
            </div>

            <div className="t-caption">Page grants</div>
            {data.owner && (
              <div className={styles.row}>
                <Avatar name={data.owner.displayName} size={26} />
                <div className={styles.rowText}>
                  <div className={styles.rowName}>{data.owner.displayName}</div>
                  <div className={styles.rowMeta}>{data.owner.email}</div>
                </div>
                <Badge hue="accent">Owner</Badge>
                <span className={styles.rowLevel}>Full access</span>
              </div>
            )}
            {data.grants
              .filter((g) => g.userId !== data.owner?.id)
              .map((grant) => (
                <div key={grant.userId} className={styles.row}>
                  <Avatar name={grant.displayName} size={26} />
                  <div className={styles.rowText}>
                    <div className={styles.rowName}>{grant.displayName}</div>
                    <div className={styles.rowMeta}>{grant.email}</div>
                  </div>
                  <Select
                    value={grant.level}
                    disabled={busy}
                    onChange={(e) =>
                      mutate(() =>
                        call(`/pages/${pageId}/permissions`, {
                          method: "POST",
                          body: JSON.stringify({ email: grant.email, level: e.target.value }),
                        }),
                      )
                    }
                  >
                    <option value="VIEW">Can view</option>
                    <option value="EDIT">Can edit</option>
                    <option value="FULL">Full access</option>
                  </Select>
                  <IconButton
                    label={`Remove ${grant.displayName}`}
                    disabled={busy}
                    onClick={() =>
                      mutate(() =>
                        call(`/pages/${pageId}/permissions/${grant.userId}`, {
                          method: "DELETE",
                        }),
                      )
                    }
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ))}

            <div className={styles.warning}>
              Page grants can only widen access. You cannot reduce someone&apos;s space-level
              access from this page.
            </div>

            <footer className={styles.footer}>
              <span className={styles.footerNote}>
                Saving clears the cached permissions for this page and all {data.descendants}{" "}
                descendant{data.descendants === 1 ? "" : "s"}.
              </span>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onClose}>Save</Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
