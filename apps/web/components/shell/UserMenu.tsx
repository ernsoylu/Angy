"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import styles from "./shell.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function signOut() {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    window.location.assign("/signin");
  }

  return (
    <div ref={wrap} className={styles.userMenuWrap}>
      <button aria-label="Account" onClick={() => setOpen((v) => !v)}>
        <Avatar name={name} size={30} />
      </button>
      {open && (
        <div className={styles.userMenu} role="menu">
          <div className={styles.userMenuHead}>
            <div className={styles.userMenuName}>{name}</div>
            <div className={styles.userMenuEmail}>{email}</div>
          </div>
          <button className={styles.userMenuItem} role="menuitem" onClick={() => void signOut()}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
