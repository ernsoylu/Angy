import type { Metadata } from "next";
import { History, Search, ShieldCheck, Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Callout } from "../../components/ui/Callout";
import shell from "../../components/shell/shell.module.css";
import styles from "./signin.module.css";

export const metadata: Metadata = { title: "Sign in · Angy" };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Sign-in screen per frontend.pen frame 6. No local passwords — OIDC only. */
export default function SignInPage() {
  return (
    <main className={styles.split}>
      <section className={styles.brandPane}>
        <div className={styles.brandRow}>
          <span className={shell.logo}>A</span>
          Angy
        </div>
        <div className={styles.headline}>
          <h1 className="t-title">Your company&apos;s knowledge, one page at a time.</h1>
          <div className={styles.features}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>
                <Users size={16} />
              </span>
              Edit together in real time, with live cursors
            </div>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>
                <History size={16} />
              </span>
              Every version kept — restore without losing history
            </div>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>
                <Search size={16} />
              </span>
              Typo-tolerant search across every space you can read
            </div>
          </div>
        </div>
        <div className={styles.footer}>Secured by OIDC single sign-on</div>
      </section>

      <section className={styles.formPane}>
        <div className={styles.form}>
          <h1 className="t-h2" style={{ fontSize: 28 }}>
            Sign in to Angy
          </h1>
          <p className={styles.subtitle}>
            Angy uses your workspace identity provider. There are no local passwords.
          </p>
          {/* One provider, one button (ADR 0011). The design showed a second
              one, but both pointed at this same URL — a choice that was not a
              choice. Multi-IdP is a config change if it ever becomes real. */}
          <Button
            href={`${API_URL}/auth/login`}
            icon={<ShieldCheck size={15} />}
            style={{ width: "100%" }}
          >
            Continue with Authentik
          </Button>
          <div className={styles.divider}>workspace access</div>
          <Callout tone="note">
            Accounts are provisioned by your directory. If you can&apos;t sign in, ask your
            workspace admin to grant access.
          </Callout>
          <p className={styles.terms}>
            By continuing you agree to your organization&apos;s acceptable use policy.
          </p>
        </div>
      </section>
    </main>
  );
}
