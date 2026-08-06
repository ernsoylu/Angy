"use client";

import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { GripVertical, Plus } from "lucide-react";
import styles from "./editor.module.css";

/**
 * Frame 2's block gutter: `⠿` to drag the hovered block, `+` to insert a new
 * one under it. The `+` drops an empty paragraph containing "/", which opens
 * the same palette as typing it — SLASH_ITEMS stays the single block registry.
 */
export function BlockGutter({ editor }: { editor: Editor }) {
  // DragHandle tracks the hovered node itself; we only need where it ended up.
  const node = useRef<{ pos: number; size: number } | null>(null);

  // DragHandle re-registers its ProseMirror plugin whenever this identity
  // changes, and a re-registration resets every other plugin's view — which
  // silently closes the slash menu. Keep it stable.
  const onNodeChange = useCallback(
    ({ node: hovered, pos }: { node: { nodeSize: number } | null; pos: number }) => {
      node.current = hovered ? { pos, size: hovered.nodeSize } : null;
    },
    [],
  );

  function insertBelow() {
    const current = node.current;
    if (!current) return;
    const at = current.pos + current.size;
    // The new paragraph opens at `at`, its text starts at `at + 1`, so the
    // caret goes to `at + 2` — *after* the "/". The suggestion plugin matches
    // on the text behind the caret, and focusing in front of it finds nothing.
    editor
      .chain()
      .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .focus(at + 2)
      .run();
  }

  return (
    <DragHandle
      editor={editor}
      className={styles.gutter}
      onNodeChange={onNodeChange}
    >
      <button
        type="button"
        aria-label="Insert block below"
        title="Insert block below"
        className={styles.gutterBtn}
        // Dragging is owned by the wrapper; keep the click from starting one.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={insertBelow}
      >
        <Plus size={15} />
      </button>
      <span
        aria-hidden
        title="Drag to move block"
        className={styles.gutterBtn}
        data-testid="drag-handle"
      >
        <GripVertical size={15} />
      </span>
    </DragHandle>
  );
}
