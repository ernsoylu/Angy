import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(styles.iconBtn, active && styles.iconBtnActive, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
