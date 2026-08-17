"use client";

import { useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2, Unlink } from "lucide-react";
import type { CommentThreadDto } from "@angy/shared";
import { cx } from "../../lib/cx";
import { timeAgo } from "../../lib/time";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";
import shell from "../shell/shell.module.css";
import styles from "./comments.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!body.success) throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}

/**
 * The comment rail (V2 H5.2, ADR 0014).
 *
 * Threads arrive server-rendered with the rest of the page, so a reader who
 * never replies downloads no comment data of their own. Replying and resolving
 * are relational writes: none of them touch the Y.Doc, so none of them show up
 * in the page's history as an edit.
 *
 * Resolved threads stay, behind a count. A conversation that has been settled
 * is still the record of why the paragraph reads the way it does.
 */
export function CommentsRail({
  threads: initial,
  canEdit,
  currentUserId,
}: {
  threads: CommentThreadDto[];
  canEdit: boolean;
  currentUserId: string;
}) {
  const { toast } = useToast();
  const [threads, setThreads] = useState(initial);
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);
  const shown = showResolved ? threads : open;

  function replace(updated: CommentThreadDto | null, id: string) {
    setThreads((prev) =>
      updated === null
        ? prev.filter((thread) => thread.id !== id)
        : prev.map((thread) => (thread.id === id ? updated : thread)),
    );
  }

  async function run(id: string, work: () => Promise<CommentThreadDto | null>) {
    setBusy(true);
    try {
      replace(await work(), id);
    } catch (err) {
      toast("error", "Comment action failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function reply(threadId: string) {
    const body = draft.trim();
    if (body.length === 0) return;
    await run(threadId, () =>
      call<CommentThreadDto>(`/comments/${threadId}/replies`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    );
    setDraft("");
    setReplyTo(null);
  }

  if (threads.length === 0) return null;

  return (
    <div className={shell.railGroup} data-testid="comments">
      <div className="t-caption">
        Comments {open.length > 0 && <span className={styles.badge}>{open.length}</span>}
      </div>

      {shown.map((thread) => (
        <div
          key={thread.id}
          className={cx(styles.thread, thread.resolved && styles.threadResolved)}
          data-thread={thread.id}
        >
          <div className={styles.anchor}>
            {thread.orphaned ? (
              // The text this was about is gone. Saying so beats vanishing the
              // conversation along with the sentence.
              <span className={styles.orphaned}>
                <Unlink size={12} /> on removed text
              </span>
            ) : (
              <>“{thread.anchorText}”</>
            )}
          </div>

          {thread.comments.map((comment) => (
            <div key={comment.id} className={styles.comment}>
              <Avatar name={comment.authorName} size={18} />
              <div className={styles.commentBody}>
                <div className={styles.commentMeta}>
                  <span className={styles.author}>{comment.authorName}</span>
                  <span>{timeAgo(comment.createdAt)}</span>
                  {comment.editedAt && <span className={styles.edited}>edited</span>}
                </div>
                <p className={styles.text}>{comment.body}</p>
              </div>
              {comment.authorId === currentUserId && (
                <button
                  type="button"
                  className={styles.iconAction}
                  aria-label="Delete comment"
                  disabled={busy}
                  onClick={() =>
                    void run(thread.id, () =>
                      call<CommentThreadDto | null>(`/comments/${thread.id}/${comment.id}`, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}

          {canEdit && (
            <div className={styles.actions}>
              {replyTo === thread.id ? (
                <>
                  <textarea
                    className={styles.draft}
                    value={draft}
                    autoFocus
                    rows={2}
                    aria-label="Reply"
                    placeholder="Reply…"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void reply(thread.id);
                      }
                      if (event.key === "Escape") {
                        setReplyTo(null);
                        setDraft("");
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || draft.trim().length === 0}
                    onClick={() => void reply(thread.id)}
                  >
                    Reply
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => {
                      setReplyTo(thread.id);
                      setDraft("");
                    }}
                  >
                    <MessageSquare size={12} /> Reply
                  </button>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={busy}
                    onClick={() =>
                      void run(thread.id, () =>
                        call<CommentThreadDto>(`/comments/${thread.id}/resolve`, {
                          method: "POST",
                          body: JSON.stringify({ resolved: !thread.resolved }),
                        }),
                      )
                    }
                  >
                    {thread.resolved ? (
                      <>
                        <RotateCcw size={12} /> Reopen
                      </>
                    ) : (
                      <>
                        <Check size={12} /> Resolve
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {thread.resolved && thread.resolvedByName && (
            <div className={styles.resolvedBy}>Resolved by {thread.resolvedByName}</div>
          )}
        </div>
      ))}

      {resolved.length > 0 && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setShowResolved((value) => !value)}
        >
          {showResolved ? "Hide" : "Show"} {resolved.length} resolved
        </button>
      )}
    </div>
  );
}
