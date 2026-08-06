"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Bold, Code, Italic, Strikethrough, UnderlineIcon } from "lucide-react";
import { editorExtensions } from "@angy/blocks";
import { cx } from "../../lib/cx";
import { IconButton } from "../ui/IconButton";
import { IMAGE_REQUEST_EVENT } from "./slash-items";
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
  user: { name: string };
  onPresenceChange?: (users: PresenceUser[], status: string) => void;
}

/**
 * The collaborative editor (frame 2). Client-only, mounted exclusively behind
 * the explicit Edit action — immediatelyRender: false is mandatory in Next.js
 * (hard rule 6). Undo/redo comes from Collaboration, not StarterKit.
 */
export function Editor({ pageId, user, onPresenceChange }: EditorProps) {
  const [status, setStatus] = useState("connecting");

  // The provider lives for the lifetime of the mounted editor. Tokens are
  // 15-minute page-scoped JWTs, so every (re)connect fetches a fresh one —
  // otherwise a network blip past expiry strands the reconnect loop.
  const provider = useMemo(
    () =>
      new HocuspocusProvider({
        url: REALTIME_URL,
        name: pageId,
        token: async () => {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/pages/${pageId}/realtime-token`,
            { credentials: "include" },
          );
          const body = await res.json();
          if (!body.success) throw new Error(body.error.message);
          return body.data.token as string;
        },
      }),
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

  // "/image" flow: the slash item asks for a file; we upload it as a page
  // attachment and embed the stable docSrc (never an expiring signed URL).
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const open = () => imageInput.current?.click();
    dom.addEventListener(IMAGE_REQUEST_EVENT, open);
    return () => dom.removeEventListener(IMAGE_REQUEST_EVENT, open);
  }, [editor]);

  async function uploadImage(file: File) {
    if (!editor) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/pages/${pageId}/attachments`,
      { method: "POST", credentials: "include", body: form },
    );
    const body = await res.json();
    if (body.success) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: { src: body.data.docSrc as string, alt: body.data.fileName as string },
        })
        .run();
    }
  }

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
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        data-testid="editor-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadImage(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
