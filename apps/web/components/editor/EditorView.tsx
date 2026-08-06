"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudUpload, GitCommitHorizontal, Radio, Users } from "lucide-react";
import { Banner } from "../ui/Feedback";
import { Avatar } from "../ui/Avatar";
import { StatusDot } from "../ui/Badge";
import shell from "../shell/shell.module.css";
import { Editor, type PresenceUser } from "./Editor";

interface EditorViewProps {
  pageId: string;
  token: string;
  title: string;
  version: number | null;
  spaceKey: string;
  breadcrumb: { id: string; title: string }[];
  user: { name: string };
}

/** Editor screen chrome per frame 2: live banner, article column, presence rail. */
function EditableTitle({ pageId, initial }: { pageId: string; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  async function save() {
    const next = value.trim();
    if (!next || next === initial) {
      setValue(next || initial);
      return;
    }
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/pages/${pageId}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      },
    );
    const body = await res.json();
    if (body.success) router.refresh(); // breadcrumb + tree pick up the rename
    else setValue(initial);
  }

  return (
    <input
      className="t-title"
      aria-label="Page title"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
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

export function EditorView({
  pageId,
  token,
  title,
  version,
  spaceKey,
  breadcrumb,
  user,
}: EditorViewProps) {
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState("connecting");

  return (
    <>
      <Banner>
        Live editing — anyone with view access sees these changes within a few seconds. There is no
        draft state.
      </Banner>
      <div className={shell.readerGrid}>
        <article className={shell.article}>
          <nav style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 16 }}>
            {breadcrumb.slice(0, -1).map((crumb) => (
              <span key={crumb.id}>
                <Link href={`/s/${spaceKey}/${crumb.id}`} style={{ color: "var(--text-2)" }}>
                  {crumb.title}
                </Link>
                {" › "}
              </span>
            ))}
            <span style={{ color: "var(--text)" }}>{title}</span>
          </nav>
          <EditableTitle pageId={pageId} initial={title} />
          <Editor
            pageId={pageId}
            token={token}
            user={user}
            onPresenceChange={(users, s) => {
              setPresence(users);
              setStatus(s);
            }}
          />
        </article>

        <aside className={shell.rail}>
          <div className={shell.railGroup}>
            <div className="t-caption">Editing now</div>
            {presence.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Connecting…</div>
            )}
            {presence.map((p, i) => (
              <div key={`${p.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={p.name} size={26} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {p.name === user.name ? "you" : "in this document"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className={shell.railGroup}>
            <div className="t-caption">Session</div>
            <div className={shell.railItem}>
              <CloudUpload size={14} /> Persisted to S3 · 2s debounce
            </div>
            {version !== null && (
              <div className={shell.railItem}>
                <GitCommitHorizontal size={14} /> Y.Doc revision {version}
              </div>
            )}
            <div className={shell.railItem}>
              <Users size={14} /> {presence.length} live connection
              {presence.length === 1 ? "" : "s"}
            </div>
            <div className={shell.railItem}>
              <Radio size={14} />
              <StatusDot status={status === "connected" ? "live" : "offline"}>
                {status === "connected" ? "Live" : status}
              </StatusDot>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
