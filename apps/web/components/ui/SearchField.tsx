import type { InputHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { Kbd } from "./Kbd";
import styles from "./ui.module.css";

export function SearchField(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={styles.search}>
      <Search size={15} />
      <input type="search" {...props} />
      <Kbd>⌘K</Kbd>
    </div>
  );
}
