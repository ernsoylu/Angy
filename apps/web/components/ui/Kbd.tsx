import type { ReactNode } from "react";
import styles from "./ui.module.css";

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
