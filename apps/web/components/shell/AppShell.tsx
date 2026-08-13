"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSign,
  Bell,
  Check,
  FileText,
  Home,
  History,
  ListChecks,
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
import { useEscape } from "../../lib/useEscape";
import type { TreeNode } from "../../lib/tree";
import { NewPageDialog } from "../pageops/NewPageDialog";
import { ShareDialog } from "../share/ShareDialog";
import { PageTree } from "./PageTree";
import { UserMenu } from "./UserMenu";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { SearchField } from "../ui/SearchField";
import { ToastProvider } from "../ui/ToastProvider";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./shell.module.css";

interface AppShellProps {
  user: { name: string; email: string };
  space: { id: string; key: string; name: string };
  tree: TreeNode[];
  children: ReactNode;
}

const PAGE_ROUTE = /^\/s\/[^/]+\/[0-9a-f-]{36}$/;
const EDIT_ROUTE = /^\/s\/[^/]+\/[0-9a-f-]{36}\/edit$/;

export function AppShell({ user, space, tree, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Unlike the dialogs, the drawer had no keyboard dismissal at all — the only
  // ways out were the menu button and clicking the overlay, both mouse-only
  // once it covered the screen. Escape is the missing half, and it is what
  // makes the overlay's click handler a convenience rather than the only exit.
  useEscape(() => setDrawerOpen(false));
  const [shareOpen, setShareOpen] = useState(false);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const pathname = usePathname();
  const spaceHome = `/s/${space.key}`;
  const searchHref = `/s/${space.key}/search`;
  const meHref = `/s/${space.key}/me`;
  const onPage = PAGE_ROUTE.test(pathname);
  const onEditor = EDIT_ROUTE.test(pathname);
  const currentPageId = pathname.match(/([0-9a-f-]{36})/)?.[1] ?? null;

  // The mobile Page tab needs a target even from Search or Trash, so remember
  // the last page visited this session.
  const [lastPageHref, setLastPageHref] = useState<string | null>(null);
  useEffect(() => {
    if (currentPageId) setLastPageHref(`${spaceHome}/${currentPageId}`);
  }, [currentPageId, spaceHome]);

  // Frame D: cmd/ctrl+K opens search from anywhere.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <a href="#main-content" className={styles.skipLink}>
          Skip to content
        </a>
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
            <SearchField id="global-search" name="q" placeholder={`Search ${space.name}...`} />
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
            <UserMenu name={user.name} email={user.email} />
          </div>
        </header>

        <div className={styles.body}>
          {drawerOpen && (
            <div
              className={styles.overlay}
              role="presentation"
              onClick={() => setDrawerOpen(false)}
            />
          )}
          <nav className={cx(styles.sidebar, drawerOpen && styles.drawerOpen)}>
            <div className={styles.treeGroup}>
              <Link
                href={spaceHome}
                className={cx(styles.treeRow, pathname === spaceHome && styles.treeRowActive)}
              >
                <Home size={15} />
                <span className={styles.treeLabel}>Home</span>
              </Link>
              <Link
                href={`/s/${space.key}/recent`}
                className={cx(
                  styles.treeRow,
                  pathname === `/s/${space.key}/recent` && styles.treeRowActive,
                )}
              >
                <History size={15} />
                <span className={styles.treeLabel}>Recent</span>
              </Link>
              <Link
                href={`/s/${space.key}/starred`}
                className={cx(
                  styles.treeRow,
                  pathname === `/s/${space.key}/starred` && styles.treeRowActive,
                )}
              >
                <Star size={15} />
                <span className={styles.treeLabel}>Starred</span>
              </Link>
              <Link
                href={`/s/${space.key}/mentions`}
                className={cx(
                  styles.treeRow,
                  pathname === `/s/${space.key}/mentions` && styles.treeRowActive,
                )}
              >
                <AtSign size={15} />
                <span className={styles.treeLabel}>Mentions</span>
              </Link>
              <Link
                href={`/s/${space.key}/tasks`}
                className={cx(
                  styles.treeRow,
                  pathname === `/s/${space.key}/tasks` && styles.treeRowActive,
                )}
              >
                <ListChecks size={15} />
                <span className={styles.treeLabel}>Tasks</span>
              </Link>
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
            <PageTree tree={tree} activeHref={pathname} />
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

          <main id="main-content" className={styles.main}>
            {children}
          </main>
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
          <Link
            href={spaceHome}
            className={cx(styles.tabItem, pathname === spaceHome && styles.tabItemActive)}
          >
            <Home size={19} />
            Home
          </Link>
          <Link
            href={searchHref}
            className={cx(styles.tabItem, pathname === searchHref && styles.tabItemActive)}
          >
            <Search size={19} />
            Search
          </Link>
          {/* "Page" points at whatever page you were last on; with none open it
            has nowhere to go, so it reads as disabled rather than dead. */}
          <Link
            href={lastPageHref ?? spaceHome}
            aria-disabled={lastPageHref ? undefined : true}
            className={cx(
              styles.tabItem,
              onPage && styles.tabItemActive,
              !lastPageHref && styles.tabItemDisabled,
            )}
            onClick={(event) => {
              if (!lastPageHref) event.preventDefault();
            }}
          >
            <FileText size={19} />
            Page
          </Link>
          <Link
            href={meHref}
            className={cx(styles.tabItem, pathname === meHref && styles.tabItemActive)}
          >
            <User size={19} />
            Me
          </Link>
        </nav>
      </div>
    </ToastProvider>
  );
}
