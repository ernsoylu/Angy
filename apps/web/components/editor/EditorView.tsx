"use client";

import { useState } from "react";
import Link from "next/link";
import { CloudUpload, GitCommitHorizontal, Radio, Users } from "lucide-react";
import type { CommentThreadDto } from "@angy/shared";
import { Banner } from "../ui/Feedback";
import { Avatar } from "../ui/Avatar";
import { StatusDot } from "../ui/Badge";
import { CommentHighlights } from "../comments/CommentHighlights";
import { CommentsRail } from "../comments/CommentsRail";
import shell from "../shell/shell.module.css";
import { RestrictedState } from "../ui/SystemState";
import { Editor, type PresenceUser } from "./Editor";

interface EditorViewProps {
  pageId: string;
  title: string;
  version: number | null;
  spaceKey: string;
  breadcrumb: { id: string; title: string }[];
  user: { id: string; name: string };
  /** Comment threads as the server had them when the editor was opened. */
  threads: CommentThreadDto[];
}

/** Editor screen chrome per frame 2: live banner, article column, presence rail. */
export function EditorView({
  pageId,
  title,
  version,
  spaceKey,
  breadcrumb,
  user,
  threads: initialThreads,
}: EditorViewProps) {
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState("connecting");
  const [accessLost, setAccessLost] = useState(false);
  const [threads, setThreads] = useState(initialThreads);
  // The Y.Doc owns the title now, so the breadcrumb tracks it rather than the
  // value the server rendered with.
  const [liveTitle, setLiveTitle] = useState(title);

  // Live revocation (ADR 0008): the server closed us out — show the design
  // state instead of a dead editor.
  if (accessLost) return <RestrictedState />;

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
            <span style={{ color: "var(--text)" }}>{liveTitle}</span>
          </nav>
          {/* Same rule as the reader: only open threads paint their anchor. */}
          <CommentHighlights
            threadIds={threads
              .filter((thread) => !thread.resolved && !thread.orphaned)
              .map((thread) => thread.id)}
          />
          <Editor
            pageId={pageId}
            user={user}
            title={title}
            onThreadCreated={(thread) => setThreads((prev) => [...prev, thread])}
            onAccessLost={() => setAccessLost(true)}
            onTitleChange={setLiveTitle}
            onPresenceChange={(users, s) => {
              setPresence(users);
              setStatus(s);
            }}
          />
        </article>

        <aside className={shell.rail}>
          <CommentsRail
            threads={threads}
            canEdit
            currentUserId={user.id}
            onThreadsChange={setThreads}
          />
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
