"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Home,
  History,
  Menu,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  User,
} from "lucide-react";
import { cx } from "../../lib/cx";
import type { TreeNode } from "../../lib/tree";
import { NewPageDialog } from "../pageops/NewPageDialog";
import { ShareDialog } from "../share/ShareDialog";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { SearchField } from "../ui/SearchField";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./shell.module.css";

interface AppShellProps {
  user: { name: string };
  space: { id: string; key: string; name: string };
  tree: TreeNode[];
  children: ReactNode;
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const active = pathname === node.href;
  const isFolder = node.children.length > 0;

  return (
    <>
      <span style={{ display: "flex", alignItems: "center" }}>
        <Link
          href={node.href}
          className={cx(styles.treeRow, active && styles.treeRowActive)}
          style={{ paddingLeft: 8 + depth * 20, flex: 1 }}
          aria-current={active ? "page" : undefined}
        >
          {isFolder && (
            <span
              className={styles.treeChevron}
              onClick={(e) => {
                e.preventDefault();
                setOpen((v) => !v);
              }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          )}
          {isFolder ? <Folder size={15} /> : <FileText size={15} />}
          <span className={styles.treeLabel}>{node.title}</span>
        </Link>
      </span>
      {isFolder &&
        open &&
        node.children.map((child) => <TreeItem key={child.id} node={child} depth={depth + 1} />)}
    </>
  );
}

const PAGE_ROUTE = /^\/s\/[^/]+\/[0-9a-f-]{36}$/;
const EDIT_ROUTE = /^\/s\/[^/]+\/[0-9a-f-]{36}\/edit$/;

export function AppShell({ user, space, tree, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const pathname = usePathname();
  const spaceHome = `/s/${space.key}`;
  const onPage = PAGE_ROUTE.test(pathname);
  const onEditor = EDIT_ROUTE.test(pathname);
  const currentPageId = pathname.match(/([0-9a-f-]{36})/)?.[1] ?? null;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.menuBtn}>
          <IconButton label="Menu" onClick={() => setDrawerOpen((v) => !v)}>
            <Menu size={17} />
          </IconButton>
        </span>
        <span className={styles.logo}>A</span>
        <span className={styles.wsName}>Angy</span>
        <span className={styles.crumbSlash}>/</span>
        <Link href={spaceHome} className={styles.spaceChip}>
          {space.name}
        </Link>
        <form className={styles.topSearch} action={`/s/${space.key}/search`}>
          <SearchField name="q" placeholder={`Search ${space.name}...`} />
        </form>
        <div className={styles.topRight}>
          {onPage && currentPageId && (
            <Button variant="secondary" onClick={() => setShareOpen(true)}>
              Share
            </Button>
          )}
          <span className={styles.editBtn}>
            {onEditor ? (
              <Button
                variant="secondary"
                icon={<Check size={14} />}
                onClick={() => {
                  // Explicit-save checkpoint (ADR 0006); keepalive survives the
                  // full navigation back to the SSR reader.
                  if (currentPageId) {
                    void fetch(
                      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/pages/${currentPageId}/revisions`,
                      { method: "POST", credentials: "include", keepalive: true },
                    );
                  }
                  window.location.assign(pathname.replace(/\/edit$/, ""));
                }}
              >
                Done
              </Button>
            ) : (
              <Link href={onPage ? `${pathname}/edit` : "#"}>
                <Button icon={<Pencil size={14} />} disabled={!onPage}>
                  Edit
                </Button>
              </Link>
            )}
          </span>
          <IconButton label="Notifications">
            <Bell size={15} />
          </IconButton>
          <ThemeToggle />
          <Avatar name={user.name} size={30} />
        </div>
      </header>

      <div className={styles.body}>
        {drawerOpen && <div className={styles.overlay} onClick={() => setDrawerOpen(false)} />}
        <nav className={cx(styles.sidebar, drawerOpen && styles.drawerOpen)}>
          <div className={styles.treeGroup}>
            <Link
              href={spaceHome}
              className={cx(styles.treeRow, pathname === spaceHome && styles.treeRowActive)}
            >
              <Home size={15} />
              <span className={styles.treeLabel}>Home</span>
            </Link>
            <a href="#" className={styles.treeRow}>
              <History size={15} />
              <span className={styles.treeLabel}>Recent</span>
            </a>
            <a href="#" className={styles.treeRow}>
              <Star size={15} />
              <span className={styles.treeLabel}>Starred</span>
            </a>
            <Link
              href={`/s/${space.key}/attachments`}
              className={cx(
                styles.treeRow,
                pathname === `/s/${space.key}/attachments` && styles.treeRowActive,
              )}
            >
              <Paperclip size={15} />
              <span className={styles.treeLabel}>Attachments</span>
            </Link>
            <Link
              href={`/s/${space.key}/trash`}
              className={cx(
                styles.treeRow,
                pathname === `/s/${space.key}/trash` && styles.treeRowActive,
              )}
            >
              <Trash2 size={15} />
              <span className={styles.treeLabel}>Trash</span>
            </Link>
          </div>
          <div className={cx("t-caption", styles.sidebarSection)}>{space.name}</div>
          <div className={styles.treeGroup}>
            {tree.map((node) => (
              <TreeItem key={node.id} node={node} depth={0} />
            ))}
          </div>
          <div className={styles.newPage}>
            <Button
              variant="secondary"
              icon={<Plus size={15} />}
              style={{ width: "100%" }}
              onClick={() => setNewPageOpen(true)}
            >
              <span className={styles.newPageLabel}>New page</span>
            </Button>
          </div>
        </nav>

        <main className={styles.main}>{children}</main>
      </div>

      {shareOpen && currentPageId && (
        <ShareDialog pageId={currentPageId} onClose={() => setShareOpen(false)} />
      )}
      {newPageOpen && (
        <NewPageDialog
          spaceId={space.id}
          spaceKey={space.key}
          spaceName={space.name}
          tree={tree}
          onClose={() => setNewPageOpen(false)}
        />
      )}

      <nav className={styles.tabbar}>
        <Link href={spaceHome} className={cx(styles.tabItem, styles.tabItemActive)}>
          <Home size={19} />
          Home
        </Link>
        <a href="#" className={styles.tabItem}>
          <Search size={19} />
          Search
        </a>
        <a href="#" className={styles.tabItem}>
          <FileText size={19} />
          Page
        </a>
        <a href="#" className={styles.tabItem}>
          <User size={19} />
          Me
        </a>
      </nav>
    </div>
  );
}
