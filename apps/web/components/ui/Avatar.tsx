import type { ReactNode } from "react";
import styles from "./ui.module.css";

/** Avatar sizes from frame C: 18 · 22 · 26 · 30, initials at 37% of size. */
export type AvatarSize = 18 | 22 | 26 | 30;

const palette = ["var(--sage)", "var(--lilac)", "var(--amber)", "var(--clay)", "var(--accent)"];

function hueFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[h]!;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({ name, size = 26 }: { name: string; size?: AvatarSize }) {
  return (
    <span
      className={styles.avatar}
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.37),
        background: hueFor(name),
      }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ children }: { children: ReactNode }) {
  return <span className={styles.avatarStack}>{children}</span>;
}
