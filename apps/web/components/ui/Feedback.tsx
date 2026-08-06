import type { CSSProperties, ReactNode } from "react";
import { AlertCircle, Check, Radio, X } from "lucide-react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

export function Banner({ children }: { children: ReactNode }) {
  return (
    <div className={styles.banner} role="status">
      <Radio size={14} />
      {children}
    </div>
  );
}

export function Toast({
  tone,
  title,
  children,
  onClose,
}: {
  tone: "success" | "error";
  title: string;
  children?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={styles.toast} role="status">
      <span
        className={cx(
          styles.toastIcon,
          tone === "success" ? styles.toastIconSuccess : styles.toastIconError,
        )}
      >
        {tone === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
      </span>
      <div>
        <div className={styles.toastTitle}>{title}</div>
        {children && <div className={styles.toastBody}>{children}</div>}
      </div>
      <button className={styles.toastClose} aria-label="Dismiss" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  );
}

export function Skeleton({
  width,
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) {
  return <div className={styles.skeleton} style={{ width, height, ...style }} aria-hidden />;
}

export function Progress({ value, hue = "accent" }: { value: number; hue?: string }) {
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={styles.progressFill}
        style={{ width: `${value}%`, background: `var(--${hue})` }}
      />
    </div>
  );
}
