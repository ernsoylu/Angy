"use client";

import { useEffect } from "react";

/** Frame D: Esc closes the topmost layer and returns focus to its opener. */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
}
