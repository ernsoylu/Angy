import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={styles.selectWrap}>
      <select className={cx(styles.select, className)} {...rest}>
        {children}
      </select>
      <ChevronDown size={15} />
    </span>
  );
}
