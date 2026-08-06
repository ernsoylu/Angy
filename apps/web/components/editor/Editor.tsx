"use client";

import { useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Bold, Code, Italic, Strikethrough, UnderlineIcon } from "lucide-react";
import { editorExtensions } from "@angy/blocks";
import { cx } from "../../lib/cx";
import { IconButton } from "../ui/IconButton";
import { SlashCommand } from "./SlashMenu";
import styles from "./editor.module.css";

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:3002";

const CARET_COLORS = ["#7E9BD4", "#B49CD0", "#DDB578", "#D89A94", "#8FB89A"];

export interface PresenceUser {
  name: string;
  color: string;
}

interface EditorProps {
  pageId: string;
  token: string;
  user: { name: string };
  onPresenceChange?: (users: PresenceUser[], status: string) => void;
}

/**
 * The collaborative editor (frame 2). Client-only, mounted exclusively behind
 * the explicit Edit action — immediatelyRender: false is mandatory in Next.js
 * (hard rule 6). Undo/redo comes from Collaboration, not StarterKit.
 */
export function Editor({ pageId, token, user, onPresenceChange }: EditorProps) {
  const [status, setStatus] = useState("connecting");

  // The provider lives for the lifetime of the mounted editor; the token is
  // only consumed on the initial connect, so pageId is the true dependency.
  const provider = useMemo(
    () => new HocuspocusProvider({ url: REALTIME_URL, name: pageId, token }),
    [pageId],
  );

  const color = useMemo(
    () => CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)]!,
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...editorExtensions(),
      SlashCommand,
      Collaboration.configure({ document: provider.document }),
      CollaborationCaret.configure({ provider, user: { name: user.name, color } }),
    ],
    editorProps: {
      attributes: { class: cx("article-prose", styles.editorContent) },
    },
  });

  useEffect(() => {
    const update = () => {
      const users = [...provider.awareness!.getStates().values()]
        .map((state) => state.user as PresenceUser | undefined)
        .filter((u): u is PresenceUser => Boolean(u?.name));
      onPresenceChange?.(users, status);
    };
    provider.awareness?.on("change", update);
    const onStatus = ({ status: s }: { status: string }) => setStatus(s);
    provider.on("status", onStatus);
    update();
    return () => {
      provider.awareness?.off("change", update);
      provider.off("status", onStatus);
    };
  }, [provider, status, onPresenceChange]);

  useEffect(() => () => provider.destroy(), [provider]);

  if (!editor) return null;

  return (
    <>
      <BubbleMenu editor={editor} className={styles.bubble}>
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
        <IconButton
          label="Code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleMark("code").run()}
        >
          <Code size={14} />
        </IconButton>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
}
