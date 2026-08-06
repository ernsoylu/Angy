import type { ReactNode } from "react";
import { EyeOff, FilePlus2, Lock } from "lucide-react";
import { Button } from "./Button";
import { Skeleton } from "./Feedback";
import styles from "./ui.module.css";

/**
 * The four mandatory system states (frame 11): every data-driven surface must
 * express loading, empty, restricted, and error. No silent failure, no blank
 * ambiguity.
 */

export function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 24 }} aria-busy>
      <Skeleton width="24%" />
      <Skeleton width="100%" height={28} />
      <Skeleton width="58%" />
      <div style={{ height: 8 }} />
      <Skeleton width="100%" />
      <Skeleton width="86%" />
      <Skeleton width="100%" height={72} />
      <Skeleton width="72%" />
    </div>
  );
}

function StateShell({
  icon,
  iconBg,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.stateWrap}>
      <div className={styles.stateIcon} style={{ background: iconBg }}>
        {icon}
      </div>
      <div className={styles.stateTitle}>{title}</div>
      <p className={styles.stateBody}>{body}</p>
      {action && <div className={styles.stateAction}>{action}</div>}
    </div>
  );
}

export function EmptyState({
  title = "No pages in this space yet",
  body = "This space is ready but empty. Create the first page to give the team somewhere to start.",
  actionLabel = "Create the first page",
  onAction,
  action,
}: {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Replaces the default button — pass `null` where the empty state is purely
   * informational (a list that fills itself as you use the app), or a link for
   * server-rendered surfaces that can't hand down a callback.
   */
  action?: ReactNode | null;
}) {
  return (
    <StateShell
      icon={<FilePlus2 size={22} style={{ color: "var(--sage)" }} />}
      iconBg="var(--sage-soft)"
      title={title}
      body={body}
      /*
       * No handler, no button. The default used to render
       * `<Button onClick={onAction}>` regardless, so any caller that forgot
       * `onAction` shipped a button that looked live and did nothing — which
       * three of them did, including the "Create the first page" button that
       * is the only route out of an empty space. An absent affordance is a
       * smaller lie than a dead one.
       */
      action={action !== undefined ? action : onAction ? <Button onClick={onAction}>{actionLabel}</Button> : null}
    />
  );
}

export function RestrictedState() {
  return (
    <StateShell
      icon={<Lock size={22} style={{ color: "var(--amber)" }} />}
      iconBg="var(--amber-soft)"
      title="You don't have access to this page"
      body="It lives in a space your account can't view. Page permissions only widen access, so a space admin has to grant it."
      action={<Button variant="secondary">Request access</Button>}
    />
  );
}

export function ErrorState({
  title = "Can't reach the realtime service",
  body = "Your edits are kept locally and will sync automatically when the connection returns. Nothing is lost.",
  actionLabel = "Retry connection",
  onAction,
}: {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <StateShell
      icon={<EyeOff size={22} style={{ color: "var(--clay)" }} />}
      iconBg="var(--clay-soft)"
      title={title}
      body={body}
      action={
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      }
    />
  );
}
