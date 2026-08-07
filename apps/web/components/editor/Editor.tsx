"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { editorExtensions } from "@angy/blocks";
import { REVOKED_CLOSE_REASON } from "@angy/shared";
import { cx } from "../../lib/cx";
import { BlockGutter } from "./BlockGutter";
import { BubbleToolbar } from "./BubbleToolbar";
import { CollaborativeTitle } from "./CollaborativeTitle";
import { TableToolbar } from "./TableToolbar";
import { IMAGE_REQUEST_EVENT, PAGE_REQUEST_EVENT } from "./slash-items";
import { PageLinkDialog } from "../pageops/PageLinkDialog";
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
  /** Server-known title, shown until the doc syncs (see CollaborativeTitle). */
  title: string;
  onPresenceChange?: (users: PresenceUser[], status: string) => void;
  /** Fired when auth fails — first connect or live revocation (ADR 0008). */
  onAccessLost?: () => void;
  /** Live title, so the surrounding chrome (breadcrumb) can follow along. */
  onTitleChange?: (title: string) => void;
}

/**
 * The collaborative editor (frame 2). Client-only, mounted exclusively behind
 * the explicit Edit action — immediatelyRender: false is mandatory in Next.js
 * (hard rule 6). Undo/redo comes from Collaboration, not StarterKit.
 */
export function Editor({
  pageId,
  user,
  title,
  onPresenceChange,
  onAccessLost,
  onTitleChange,
}: EditorProps) {
  const [status, setStatus] = useState("connecting");
  const [synced, setSynced] = useState(false);

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
    () => CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)]!, // NOSONAR — cosmetic caret tint, not a secret
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
    const onAuthFail = () => onAccessLost?.();
    provider.on("authenticationFailed", onAuthFail);
    // Live revocation (ADR 0008) closes the connection rather than failing
    // authentication, so without this the provider just retries and the user
    // sees "offline" — a network problem, not a refusal. Match on the reason:
    // the provider hardcodes code 1000 for a document-level close, so the
    // server's 4403 never arrives.
    const onClose = ({ event }: { event: CloseEvent }) => {
      if (event.reason === REVOKED_CLOSE_REASON) onAccessLost?.();
    };
    provider.on("close", onClose);
    update();
    return () => {
      provider.awareness?.off("change", update);
      provider.off("status", onStatus);
      provider.off("authenticationFailed", onAuthFail);
      provider.off("close", onClose);
    };
  }, [provider, status, onPresenceChange, onAccessLost]);

  // The title input only becomes editable once the doc has synced, so track it
  // separately from connection status (connected ≠ state received).
  useEffect(() => {
    const onSynced = () => setSynced(true);
    provider.on("synced", onSynced);
    if (provider.isSynced) setSynced(true);
    return () => {
      provider.off("synced", onSynced);
    };
  }, [provider]);

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

  // "/page" flow: pick an existing page or create a named one, then drop a
  // reference to it here. It used to create "Untitled" outright, which made
  // the common case — linking a page that already exists — impossible, and
  // left the rare case with a name nobody could change: the link node is an
  // atom, so its label is not editable in place.
  const [linkPicker, setLinkPicker] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const open = () => setLinkPicker(true);
    dom.addEventListener(PAGE_REQUEST_EVENT, open);
    return () => dom.removeEventListener(PAGE_REQUEST_EVENT, open);
  }, [editor]);

  function insertPageLink(page: { id: string; title: string }) {
    setLinkPicker(false);
    editor
      ?.chain()
      .focus()
      .insertContent({ type: "pageLink", attrs: { pageId: page.id, title: page.title } })
      .run();
  }

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

  return (
    <>
      {/* The title lives in the same Y.Doc as the body, so it renders here —
          beside the content it travels with — not in the surrounding chrome. */}
      <CollaborativeTitle
        ydoc={provider.document}
        synced={synced}
        fallback={title}
        onChange={onTitleChange}
      />
      {!editor ? null : (
        <>
          <BubbleToolbar editor={editor} />
          <TableToolbar editor={editor} />
          <BlockGutter editor={editor} />
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
      )}

      {linkPicker && (
        <PageLinkDialog
          pageId={pageId}
          onPick={insertPageLink}
          onClose={() => setLinkPicker(false)}
        />
      )}
    </>
  );
}
