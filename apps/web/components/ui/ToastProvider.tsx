"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "./Feedback";
import styles from "./ui.module.css";

interface ToastData {
  id: number;
  tone: "success" | "error";
  title: string;
  body?: string;
}

interface ToastApi {
  toast: (tone: ToastData["tone"], title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => undefined });

export const useToast = () => useContext(ToastContext);

const TOAST_TTL_MS = 5000;

/** Bottom-centre toast stack per frame C. Mounted once, inside the app shell. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastData["tone"], title: string, body?: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, tone, title, body }]);
      setTimeout(() => dismiss(id), TOAST_TTL_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className={styles.toastStack}>
          {toasts.map((t) => (
            <Toast key={t.id} tone={t.tone} title={t.title} onClose={() => dismiss(t.id)}>
              {t.body}
            </Toast>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
