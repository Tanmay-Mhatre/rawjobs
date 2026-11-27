import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Kbd } from "./Kbd";

/** design/components/Button. Secondary is the default; one primary per screen; danger is outlined, never filled. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** sm (28px) for row-level actions. */
  size?: "md" | "sm";
  /** A 16px Lucide icon before the label, given className="rj-icon". */
  icon?: ReactNode;
  /** A key shown after the label, e.g. "R" for Scan now. */
  shortcut?: string;
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "md" | "sm" = "md", className?: string) {
  return cx("rj-btn", variant !== "secondary" && `rj-btn--${variant}`, size === "sm" && "rj-btn--sm", className);
}

export function Button({ variant, size, icon, shortcut, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    // The key is shown, but announced through aria-keyshortcuts rather than read as part of the name.
    <button type={type} className={buttonClass(variant, size, className)} aria-keyshortcuts={shortcut} {...rest}>
      {icon}
      {children}
      {shortcut && <Kbd hidden>{shortcut}</Kbd>}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "icon" | "children" | "aria-label"> & {
  /** What it does, verb first ("Copy job description"). Read out and shown as the tooltip. */
  label: string;
  /** Where the tooltip opens: "above" for buttons at the bottom of a panel (a job's foot). */
  tip?: "below" | "above";
  children: ReactNode;
};

/**
 * Icon-only: the label is the accessible name. Its tooltip shows on hover and on keyboard focus, with
 * the key ("Save S"); touch screens have no hover, so they get none.
 */
export function IconButton({ label, shortcut, tip = "below", variant = "quiet", size, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} aria-keyshortcuts={shortcut} className={buttonClass(variant, size, cx("rj-btn--icon", className))} {...rest}>
      {children}
      <Tooltip label={label} shortcut={shortcut} side={tip} />
    </button>
  );
}

export type IconLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "aria-label" | "target" | "rel" | "href"> & {
  href: string | undefined;
  /** Where it goes, verb first, saying it opens a new tab ("Open Careem careers page (opens in a new tab)"). */
  label: string;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  tip?: "below" | "above";
  children: ReactNode;
};

/** An icon-only link to another site, styled as an icon button. Always opens in a new tab. */
export function IconLink({ href, label, tip = "below", variant = "quiet", size, className, children, ...rest }: IconLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} className={buttonClass(variant, size, cx("rj-btn--icon", className))} {...rest}>
      {children}
      <Tooltip label={label} side={tip} />
    </a>
  );
}

/**
 * The tooltip inside an icon button: decorative for screen readers, which already hear the button's name
 * and key (aria-keyshortcuts). The key is drawn by CSS (data-key), so the button's visible text is just
 * its label and matches its name (WCAG 2.5.3, label in name).
 */
export function Tooltip({ label, shortcut, side = "below" }: { label: string; shortcut?: string; side?: "below" | "above" }) {
  return (
    <span className={cx("rj-tip", side === "above" && "rj-tip--above")} aria-hidden>
      {label}
      {shortcut && <kbd className="rj-kbd rj-tip__kbd" data-key={shortcut} aria-hidden />}
    </span>
  );
}
