"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { cx } from "../../lib/cx";
import type { TreeNode } from "../../lib/tree";
import styles from "./shell.module.css";

interface Row {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  parentId: string | null;
}

/** Depth-first walk of everything currently on screen — the traversal order. */
function visibleRows(
  nodes: TreeNode[],
  collapsed: Set<string>,
  depth = 0,
  parentId: string | null = null,
): Row[] {
  return nodes.flatMap((node) => {
    const expanded = node.children.length > 0 && !collapsed.has(node.id);
    return [
      { node, depth, expanded, parentId },
      ...(expanded ? visibleRows(node.children, collapsed, depth + 1, node.id) : []),
    ];
  });
}

/**
 * Sidebar page tree with frame D's keyboard contract:
 * ↑↓ move · → expand · ← collapse · Enter opens. Roving tabindex, so the tree
 * is a single tab stop rather than one per page.
 */
export function PageTree({ tree, activeHref }: { tree: TreeNode[]; activeHref: string }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => visibleRows(tree, collapsed), [tree, collapsed]);

  const activeIndex = rows.findIndex((row) => row.node.href === activeHref);
  const [focusId, setFocusId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // Roving tabindex: the focused row, else the current page, else the first.
  const current = rows.findIndex((row) => row.node.id === focusId);
  const tabIndex = current >= 0 ? current : activeIndex >= 0 ? activeIndex : 0;

  function toggle(id: string, expand: boolean) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (expand) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focusRow(index: number) {
    const row = rows[index];
    if (!row) return;
    setFocusId(row.node.id);
    container.current
      ?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(row.node.id)}"]`)
      ?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const index = rows.findIndex((row) => row.node.id === focusId);
    const row = rows[index];
    if (!row) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(Math.min(index + 1, rows.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(Math.max(index - 1, 0));
        break;
      case "ArrowRight":
        event.preventDefault();
        // Already open (or a leaf): step into the first child instead.
        if (row.node.children.length > 0 && !row.expanded) toggle(row.node.id, true);
        else if (row.expanded) focusRow(index + 1);
        break;
      case "ArrowLeft": {
        event.preventDefault();
        if (row.expanded) toggle(row.node.id, false);
        else if (row.parentId) focusRow(rows.findIndex((r) => r.node.id === row.parentId));
        break;
      }
      case "Enter":
        event.preventDefault();
        router.push(row.node.href);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={container}
      role="tree"
      aria-label="Pages"
      className={styles.treeGroup}
      onKeyDown={onKeyDown}
    >
      {rows.map((row, index) => {
        const isFolder = row.node.children.length > 0;
        const active = row.node.href === activeHref;
        return (
          <Link
            key={row.node.id}
            href={row.node.href}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={isFolder ? row.expanded : undefined}
            aria-current={active ? "page" : undefined}
            data-tree-id={row.node.id}
            tabIndex={index === tabIndex ? 0 : -1}
            onFocus={() => setFocusId(row.node.id)}
            className={cx(styles.treeRow, active && styles.treeRowActive)}
            style={{ paddingLeft: 8 + row.depth * 20 }}
          >
            {isFolder && (
              <span
                className={styles.treeChevron}
                onClick={(event) => {
                  event.preventDefault();
                  toggle(row.node.id, !row.expanded);
                }}
              >
                {row.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            )}
            {isFolder ? <Folder size={15} /> : <FileText size={15} />}
            <span className={styles.treeLabel}>{row.node.title}</span>
          </Link>
        );
      })}
    </div>
  );
}
