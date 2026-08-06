"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Columns3,
  Heading,
  Rows3,
  Table2,
  Trash2,
} from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import styles from "./editor.module.css";

/**
 * Table editing controls. The bubble toolbar only appears over a text
 * selection, so table structure gets its own strip — shown while the caret sits
 * inside a table, hidden otherwise.
 */
export function TableToolbar({ editor }: { editor: Editor }) {
  const inTable = useEditorState({
    editor,
    selector: ({ editor: instance }) => instance.isActive("table"),
  });

  if (!inTable) return null;

  return (
    <div className={styles.tableToolbar} data-testid="table-toolbar">
      <span className={styles.tableToolbarLabel}>
        <Table2 size={13} /> Table
      </span>
      <span className={styles.tableToolbarGroup}>
        <Rows3 size={13} />
        <Button variant="ghost" small onClick={() => editor.chain().focus().addRowBefore().run()}>
          Row above
        </Button>
        <Button variant="ghost" small onClick={() => editor.chain().focus().addRowAfter().run()}>
          Row below
        </Button>
        <Button variant="ghost" small onClick={() => editor.chain().focus().deleteRow().run()}>
          Delete row
        </Button>
      </span>
      <span className={styles.tableToolbarGroup}>
        <Columns3 size={13} />
        <Button variant="ghost" small onClick={() => editor.chain().focus().addColumnBefore().run()}>
          Column left
        </Button>
        <Button variant="ghost" small onClick={() => editor.chain().focus().addColumnAfter().run()}>
          Column right
        </Button>
        <Button variant="ghost" small onClick={() => editor.chain().focus().deleteColumn().run()}>
          Delete column
        </Button>
      </span>
      <IconButton
        label="Toggle header row"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      >
        <Heading size={14} />
      </IconButton>
      <IconButton
        label="Delete table"
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}
