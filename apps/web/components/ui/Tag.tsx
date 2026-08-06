import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

export type Hue = "accent" | "sage" | "clay" | "amber" | "lilac" | "neutral";

const hueClass: Record<Hue, string> = {
  accent: styles.tagAccent,
  sage: styles.tagSage,
  clay: styles.tagClay,
  amber: styles.tagAmber,
  lilac: styles.tagLilac,
  neutral: styles.tagNeutral,
};

export function Tag({ hue = "accent", children }: { hue?: Hue; children: ReactNode }) {
  return <span className={cx(styles.tag, hueClass[hue])}>{children}</span>;
}

export function Chip({
  selected,
  children,
  onClick,
}: {
  selected?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.chip, selected && styles.chipSelected)}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
