"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { isTextSelection } from "@tiptap/core";
import { Bold, Code, Italic, Link2, Link2Off, Strikethrough, UnderlineIcon } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import styles from "./editor.module.css";

/**
 * Format toolbar per frame 2: B I U S · link · code. The link button swaps the
 * row for a URL field; everything else is a one-shot mark toggle.
 */
export function BubbleToolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // shouldShow runs inside the ProseMirror plugin, which captured this callback
  // once — a ref is the only way it sees the current value.
  const linkOpenRef = useRef(false);
  linkOpenRef.current = linkOpen;

  useEffect(() => {
    if (linkOpen) input.current?.focus();
  }, [linkOpen]);

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
        if (linkOpenRef.current) return true;
        if (!instance.isEditable || !view.hasFocus() || state.selection.empty) return false;
        return !(isTextSelection(state.selection) && !state.doc.textBetween(from, to).trim());
      }}
      // Keep the selection alive: a mousedown inside the toolbar would blur the
      // editor and collapse what the button is about to format.
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      {linkOpen ? (
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
        </>
      )}
    </BubbleMenu>
  );
}
