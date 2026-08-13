"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { UserDto } from "@angy/shared";
import { Avatar } from "../ui/Avatar";
import { cx } from "../../lib/cx";
import styles from "./editor.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Users matching what has been typed after "@".
 *
 * Server-side search rather than fetch-all-and-filter: the picker must not
 * assume the workspace is small enough to hold in the browser, and the endpoint
 * already bounds what it returns. A failed lookup yields an empty list — a
 * mention picker that throws would take the editor down with it.
 */
async function searchUsers(query: string): Promise<UserDto[]> {
  try {
    const res = await fetch(`${API_URL}/users?q=${encodeURIComponent(query)}`, {
      credentials: "include",
    });
    const body = await res.json();
    return body.success ? (body.data as UserDto[]) : [];
  } catch {
    return [];
  }
}

interface MentionListProps {
  items: UserDto[];
  command: (user: UserDto) => void;
}

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s - 1 + items.length) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter") {
        if (items[selected]) command(items[selected]);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div className={styles.slashMenu} data-testid="mention-menu">
      <div className={cx("t-caption", styles.slashCaption)}>Mention someone</div>
      {items.map((user, index) => (
        <button
          key={user.id}
          className={cx(styles.slashItem, index === selected && styles.slashItemSelected)}
          onMouseEnter={() => setSelected(index)}
          onClick={() => command(user)}
        >
          <span className={styles.slashIcon}>
            <Avatar name={user.displayName} size={18} />
          </span>
          <span>
            <span className={styles.slashTitle}>{user.displayName}</span>
            <span className={styles.slashDesc}>{user.email}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

/**
 * "@" opens the mention picker, wired through @tiptap/suggestion like the slash
 * palette.
 *
 * `allowSpaces` is off, unlike the block palette: names contain spaces, so
 * allowing them would keep the menu open across the rest of the sentence after
 * someone types "@" and moves on. A name that needs two words is found by its
 * first.
 *
 * The node is inserted with the display name baked in as `label`. That is a
 * cache, exactly like a page link's title, and it is repaired the same two
 * ways — on the projection for readers, in the Y.Doc for editors.
 */
const MENTION_PLUGIN_KEY = new PluginKey("mentionSuggestion");

export const MentionCommand = Extension.create({
  name: "mentionCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<UserDto>({
        editor: this.editor,
        // Distinct from the slash palette's. @tiptap/suggestion defaults every
        // instance to the same PluginKey, and ProseMirror refuses two keyed
        // plugins with one key — which takes the whole editor down, not just
        // the second menu.
        pluginKey: MENTION_PLUGIN_KEY,
        char: "@",
        allowSpaces: false,
        items: ({ query }) => searchUsers(query),
        command: ({ editor, range, props }) => {
          (editor as Editor)
            .chain()
            .focus()
            .insertContentAt(range as Range, [
              { type: "mention", attrs: { userId: props.id, label: props.displayName } },
              // A trailing space, so typing continues after the atom rather
              // than immediately inside the next mention query.
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => {
          let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
          let popup: HTMLDivElement | null = null;

          const position = (rect: DOMRect | null) => {
            if (!popup || !rect) return;
            popup.style.left = `${rect.left + window.scrollX}px`;
            popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
          };

          return {
            onStart(props) {
              renderer = new ReactRenderer(MentionList, {
                props: {
                  items: props.items,
                  command: (user: UserDto) => props.command(user),
                },
                editor: props.editor,
              });
              popup = document.createElement("div");
              popup.style.position = "absolute";
              popup.style.zIndex = "60";
              popup.appendChild(renderer.element);
              document.body.appendChild(popup);
              position(props.clientRect?.() ?? null);
            },
            onUpdate(props) {
              renderer?.updateProps({
                items: props.items,
                command: (user: UserDto) => props.command(user),
              });
              position(props.clientRect?.() ?? null);
            },
            onKeyDown(props) {
              if (props.event.key === "Escape") {
                popup?.remove();
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit() {
              popup?.remove();
              renderer?.destroy();
              renderer = null;
              popup = null;
            },
          };
        },
      }),
    ];
  },
});
