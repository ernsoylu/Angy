import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./ui.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  ghost: styles.btnGhost,
  danger: styles.btnDanger,
};

interface Common {
  variant?: Variant;
  small?: boolean;
  icon?: ReactNode;
}

type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * Pass `href` and this renders an `<a>`, not a `<button>`.
 *
 * The alternative — wrapping a `<button>` in an `<a>` — is invalid HTML: an
 * anchor's content model excludes interactive elements. It is not a
 * validator-only complaint. Firefox lets the inner button swallow the click and
 * never follows the link, so a plain `<a href><Button/></a>` renders correctly
 * and does nothing when pressed. That is how the sign-in button broke.
 *
 * (Next's `<Link>` survives the same nesting only because it intercepts the
 * bubbled click in JS and navigates itself — which still loses middle-click and
 * open-in-new-tab, and fails outright without JS.)
 */
export function Button({
  variant = "primary",
  small,
  icon,
  children,
  className,
  ...rest
}: ButtonProps | LinkProps) {
  const cls = cx(styles.btn, variantClass[variant], small && styles.btnSmall, className);

  if (typeof rest.href === "string") {
    return (
      <a className={cls} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {icon}
        {children}
      </a>
    );
  }

  return (
    <button className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {icon}
      {children}
    </button>
  );
}
