"use client";

import { useEffect, useState } from "react";
import { cx } from "../../lib/cx";
import type { TocItem } from "../../lib/toc";
import shell from "../shell/shell.module.css";

/** On-this-page rail with scroll-spy: the heading in view is highlighted. */
export function Toc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? null);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [items]);

  return (
    <div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={cx(shell.tocItem, item.id === activeId && shell.tocItemActive)}
          style={{ display: "block" }}
        >
          {item.text}
        </a>
      ))}
    </div>
  );
}
