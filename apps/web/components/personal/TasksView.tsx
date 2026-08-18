"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare, Square } from "lucide-react";
import type { TaskDto } from "@angy/shared";
import { Avatar } from "../ui/Avatar";
import { EmptyState } from "../ui/SystemState";
import { cx } from "../../lib/cx";
import shell from "../shell/shell.module.css";
import list from "./page-list.module.css";
import styles from "./tasks.module.css";

/**
 * The tasks board (V2 H1), per frontend.pen frame 16 — every to-do in the
 * space, grouped by the page it lives on.
 *
 * Read-only, deliberately. A checkbox here would have to write back into the
 * page's Y.Doc, and `block_index` is a projection: making it the thing an edit
 * writes to is precisely what hard rule 2 forbids. Ticking a box belongs on
 * the page, so each row links to the page that owns it.
 */
export function TasksView({
  tasks,
  spaceKey,
  spaceName,
  me,
}: {
  tasks: TaskDto[];
  spaceKey: string;
  spaceName: string;
  me: string;
}) {
  const [mineOnly, setMineOnly] = useState(false);

  const visible = useMemo(
    () => (mineOnly ? tasks.filter((task) => task.assigneeName === me) : tasks),
    [tasks, mineOnly, me],
  );

  // Grouped in the order the API returned, so the board keeps "most recently
  // touched page first, document order within it".
  const groups = useMemo(() => {
    const byPage = new Map<string, { title: string; tasks: TaskDto[] }>();
    for (const task of visible) {
      const group = byPage.get(task.pageId);
      if (group) group.tasks.push(task);
      else byPage.set(task.pageId, { title: task.pageTitle, tasks: [task] });
    }
    return [...byPage.entries()];
  }, [visible]);

  return (
    <div className={shell.readerGrid}>
      <div className={shell.article} style={{ maxWidth: 900 }}>
        <h1 className="t-title" style={{ fontSize: 32 }}>
          Tasks
        </h1>
        <p className={list.subtitle}>Open to-dos across {spaceName}</p>

        <div className={styles.filters}>
          <button
            className={cx(styles.filter, !mineOnly && styles.filterActive)}
            onClick={() => setMineOnly(false)}
            aria-pressed={!mineOnly}
          >
            All open
          </button>
          <button
            className={cx(styles.filter, mineOnly && styles.filterActive)}
            onClick={() => setMineOnly(true)}
            aria-pressed={mineOnly}
          >
            Assigned to me
          </button>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title={mineOnly ? "Nothing assigned to you" : "No open tasks"}
            body={
              mineOnly
                ? "A to-do is yours when someone @-mentions you in it. Nothing here means nothing is waiting on you."
                : "Type /todo on any page to start a checklist. Open items collect here on their own."
            }
            action={null}
          />
        ) : (
          groups.map(([pageId, group]) => (
            <section key={pageId} className={styles.group} data-testid="task-group">
              <Link href={`/s/${spaceKey}/${pageId}`} className={styles.groupTitle}>
                {group.title}
              </Link>
              {group.tasks.map((task) => (
                <Link
                  key={`${pageId}-${task.ord}`}
                  href={`/s/${spaceKey}/${pageId}`}
                  className={styles.task}
                  data-testid="task-row"
                >
                  {task.done ? (
                    <CheckSquare size={15} className={styles.boxDone} />
                  ) : (
                    <Square size={15} className={styles.box} />
                  )}
                  <span className={cx(styles.text, task.done && styles.textDone)}>
                    {task.text || "Empty to-do"}
                  </span>
                  {task.assigneeName && (
                    <span className={styles.assignee}>
                      <Avatar name={task.assigneeName} size={18} />
                      {task.assigneeName}
                    </span>
                  )}
                </Link>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
