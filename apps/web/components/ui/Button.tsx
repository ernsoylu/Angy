import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  ghost: styles.btnGhost,
  danger: styles.btnDanger,
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  small,
  icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(styles.btn, variantClass[variant], small && styles.btnSmall, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
