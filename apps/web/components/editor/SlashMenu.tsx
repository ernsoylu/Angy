"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { cx } from "../../lib/cx";
import { filterSlashItems, type SlashItem } from "./slash-items";
import styles from "./editor.module.css";

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** The popup per frame 2: "Basic blocks" with icon, name, description rows. */
export const SlashList = forwardRef<SlashListHandle, SlashListProps>(function SlashList(
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
    <div className={styles.slashMenu} data-testid="slash-menu">
      <div className={cx("t-caption", styles.slashCaption)}>Basic blocks</div>
      {items.map((item, index) => (
        <button
          key={item.title}
          className={cx(styles.slashItem, index === selected && styles.slashItemSelected)}
          onMouseEnter={() => setSelected(index)}
          onClick={() => command(item)}
        >
          <span className={styles.slashIcon}>
            <item.icon size={15} />
          </span>
          <span>
            <span className={styles.slashTitle}>{item.title}</span>
            <span className={styles.slashDesc}>{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

/** "/" opens the block palette (Notion-style), wired via @tiptap/suggestion. */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        // Multi-word queries ("heading 2") stay open; Escape closes.
        allowSpaces: true,
        command: ({ editor, range, props }) => props.command(editor as Editor, range as Range),
        items: ({ query }) => filterSlashItems(query),
        render: () => {
          let renderer: ReactRenderer<SlashListHandle, SlashListProps> | null = null;
          let popup: HTMLDivElement | null = null;

          const position = (rect: DOMRect | null) => {
            if (!popup || !rect) return;
            popup.style.left = `${rect.left + window.scrollX}px`;
            popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
          };

          return {
            onStart(props) {
              renderer = new ReactRenderer(SlashList, {
                props: {
                  items: props.items,
                  command: (item: SlashItem) => props.command(item),
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
                command: (item: SlashItem) => props.command(item),
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
