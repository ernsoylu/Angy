"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { isTextSelection } from "@tiptap/core";
import {
  Bold,
  Code,
  Italic,
  Link2,
  Link2Off,
  MessageSquarePlus,
  Strikethrough,
  UnderlineIcon,
} from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { useToast } from "../ui/ToastProvider";
import styles from "./editor.module.css";

/**
 * Format toolbar per frame 2: B I U S · link · code, plus comment (V2 H5.2).
 * The link button swaps the row for a URL field and the comment button for a
 * remark field; everything else is a one-shot mark toggle.
 */
export function BubbleToolbar({
  editor,
  onComment,
}: {
  editor: Editor;
  onComment?: (body: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const commentInput = useRef<HTMLInputElement>(null);

  // shouldShow runs inside the ProseMirror plugin, which captured this callback
  // once — a ref is the only way it sees the current value.
  const linkOpenRef = useRef(false);
  linkOpenRef.current = linkOpen;
  // Same trap, same fix: typing the remark blurs the editor, and without this
  // the menu closes over the field the caret is in.
  const commentOpenRef = useRef(false);
  commentOpenRef.current = commentOpen;

  useEffect(() => {
    if (linkOpen) input.current?.focus();
  }, [linkOpen]);

  useEffect(() => {
    if (commentOpen) commentInput.current?.focus();
  }, [commentOpen]);

  async function submitComment() {
    const body = comment.trim();
    if (body.length === 0 || !onComment) return;
    setSaving(true);
    try {
      await onComment(body);
      setComment("");
      setCommentOpen(false);
    } catch (err) {
      toast("error", "Could not add the comment", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  function openLinkEditor() {
    setHref((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  }

  function apply() {
    const url = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url) chain.setLink({ href: url }).run();
    else chain.unsetLink().run();
    setLinkOpen(false);
  }

  return (
    <BubbleMenu
      editor={editor}
      className={styles.bubble}
      shouldShow={({ editor: instance, view, state, from, to }) => {
        // Editing the URL blurs the editor, which would otherwise hide the
        // menu out from under the field.
        if (linkOpenRef.current || commentOpenRef.current) return true;
        if (!instance.isEditable || !view.hasFocus() || state.selection.empty) return false;
        return !(isTextSelection(state.selection) && !state.doc.textBetween(from, to).trim());
      }}
      // Keep the selection alive: a mousedown inside the toolbar would blur the
      // editor and collapse what the button is about to format.
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      {commentOpen ? (
        <>
          <input
            ref={commentInput}
            className={styles.linkInput}
            aria-label="Comment"
            placeholder="Add a comment…"
            value={comment}
            disabled={saving}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitComment();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setCommentOpen(false);
                setComment("");
                editor.chain().focus().run();
              }
            }}
          />
          <IconButton
            label="Save comment"
            disabled={saving || comment.trim().length === 0}
            onClick={() => void submitComment()}
          >
            <MessageSquarePlus size={14} />
          </IconButton>
        </>
      ) : linkOpen ? (
        <>
          <input
            ref={input}
            className={styles.linkInput}
            aria-label="Link URL"
            placeholder="https://…"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
                editor.chain().focus().run();
              }
            }}
          />
          <IconButton label="Apply link" onClick={apply}>
            <Link2 size={14} />
          </IconButton>
          <IconButton
            label="Remove link"
            onClick={() => {
              setHref("");
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              setLinkOpen(false);
            }}
          >
            <Link2Off size={14} />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleMark("bold").run()}
          >
            <Bold size={14} />
          </IconButton>
          <IconButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleMark("italic").run()}
          >
            <Italic size={14} />
          </IconButton>
          <IconButton
            label="Underline"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleMark("underline").run()}
          >
            <UnderlineIcon size={14} />
          </IconButton>
          <IconButton
            label="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleMark("strike").run()}
          >
            <Strikethrough size={14} />
          </IconButton>
          <span className={styles.bubbleDivider} />
          <IconButton label="Link" active={editor.isActive("link")} onClick={openLinkEditor}>
            <Link2 size={14} />
          </IconButton>
          <IconButton
            label="Code"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleMark("code").run()}
          >
            <Code size={14} />
          </IconButton>
          {onComment && (
            <IconButton
              label="Comment"
              active={editor.isActive("comment")}
              onClick={() => {
                setComment("");
                setCommentOpen(true);
              }}
            >
              <MessageSquarePlus size={14} />
            </IconButton>
          )}
        </>
      )}
    </BubbleMenu>
  );
}
