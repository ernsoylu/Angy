import type { CSSProperties, ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, Info } from "lucide-react";
import styles from "./ui.module.css";

/** Callout tones from frame C: note · added · hard-rule · removed. */
export type CalloutTone = "note" | "added" | "hardRule" | "removed";

const toneVars: Record<CalloutTone, CSSProperties> = {
  note: { "--tone": "var(--accent)", "--tone-soft": "var(--accent-soft)" } as CSSProperties,
  added: { "--tone": "var(--sage)", "--tone-soft": "var(--sage-soft)" } as CSSProperties,
  hardRule: { "--tone": "var(--amber)", "--tone-soft": "var(--amber-soft)" } as CSSProperties,
  removed: { "--tone": "var(--clay)", "--tone-soft": "var(--clay-soft)" } as CSSProperties,
};

const toneIcon: Record<CalloutTone, ReactNode> = {
  note: <Info size={16} />,
  added: <Check size={16} />,
  hardRule: <AlertTriangle size={16} />,
  removed: <AlertCircle size={16} />,
};

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.callout} style={toneVars[tone]}>
      {toneIcon[tone]}
      <div>
        {title && <div className={styles.calloutTitle}>{title}</div>}
        <div className={styles.calloutBody}>{children}</div>
      </div>
    </div>
  );
}
