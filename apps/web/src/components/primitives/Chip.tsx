import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";

/** design/components/Chip: a filter you turn on and off. Never for static metadata (that's plain text). */
export function Chip({
  pressed,
  count,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & { pressed: boolean; count?: number; children: ReactNode }) {
  return (
    <button type={type} className={cx("rj-chip", className)} aria-pressed={pressed} {...rest}>
      {children}
      {count != null && <span className="rj-chip__count">{count}</span>}
    </button>
  );
}

/** Chips always sit in a labelled group ("Filters"). */
export function ChipGroup({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cx("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
