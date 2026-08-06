import type { CSSProperties, ReactNode } from "react";
import type { Hue } from "./Tag";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

const badgeStyle: Record<Hue, CSSProperties> = {
  accent: { background: "var(--accent-soft)", color: "var(--accent-text)" },
  sage: { background: "var(--sage-soft)", color: "var(--sage)" },
  clay: { background: "var(--clay-soft)", color: "var(--clay)" },
  amber: { background: "var(--amber-soft)", color: "var(--amber)" },
  lilac: { background: "var(--lilac-soft)", color: "var(--lilac)" },
  neutral: { background: "var(--surface-hover)", color: "var(--text-2)" },
};

export function Badge({ hue = "accent", children }: { hue?: Hue; children: ReactNode }) {
  return (
    <span className={styles.badge} style={badgeStyle[hue]}>
      {children}
    </span>
  );
}

export type Status = "live" | "syncing" | "offline";

const statusDot: Record<Status, string> = {
  live: "var(--sage)",
  syncing: "var(--amber)",
  offline: "var(--clay)",
};

export function StatusDot({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span
      className={cx(styles.statusDot)}
      style={{ "--dot": statusDot[status] } as CSSProperties}
    >
      {children}
    </span>
  );
}
