import type { ButtonHTMLAttributes, ReactNode } from "react";
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
  children: ReactNode;
};

/** Icon-only: the label is the accessible name, and the tooltip also names the shortcut, e.g. "Save (S)". */
export function IconButton({ label, shortcut, variant = "quiet", size, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={buttonClass(variant, size, cx("rj-btn--icon", className))}
      {...rest}
    >
      {children}
    </button>
  );
}
