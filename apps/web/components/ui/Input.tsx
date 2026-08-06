import type { InputHTMLAttributes } from "react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export function Input({ error, className, ...rest }: InputProps) {
  return (
    <div className={styles.field}>
      <input
        className={cx(styles.input, error && styles.inputError, className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
}
