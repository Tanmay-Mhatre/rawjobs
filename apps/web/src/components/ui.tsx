import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Button as RjButton, IconButton as RjIconButton, Kbd as RjKbd, type ButtonVariant } from "./primitives";
import { cx } from "../lib/cx";

export { cx } from "../lib/cx";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md" };

/** The app's older names for the design system's button variants (design/components/Button). */
const VARIANT: Record<NonNullable<ButtonProps["variant"]>, ButtonVariant> = { primary: "primary", outline: "secondary", ghost: "quiet", danger: "danger" };

export function Button({ variant = "outline", size = "md", ...rest }: ButtonProps) {
  return <RjButton variant={VARIANT[variant]} size={size} {...rest} />;
}

/** Icon-only button; `active` marks a toggled-on state (aria-pressed). */
export function IconButton({ label, active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <RjIconButton label={label} aria-pressed={active} className={cx(active && "bg-active text-ink", className)} {...rest}>
      {children}
    </RjIconButton>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("h-9 rounded-md border border-line bg-raised px-2.5 type-small text-ink", className)} {...rest}>
      {children}
    </select>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 rounded-md border border-line bg-raised p-0.5">
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("rounded-md px-2.5 type-label transition-colors", o.value === value ? "bg-inset text-ink shadow-l1" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 type-small text-muted hover:text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-ink" />
      {children}
    </label>
  );
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-md border border-line bg-raised", className)}>
      {children}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <RjKbd>{children}</RjKbd>;
}

/** Page numbers to show: first, last, and the current page's neighbours, with gaps as null. */
export function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/** "Showing 26–50 of 6,592" with Prev / page numbers / Next (page numbers hidden on phones). */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <p className="tabular type-meta text-muted">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
            ‹ Prev
          </Button>
          <span className="tabular px-1 type-meta text-muted sm:hidden">
            Page {page} of {pages.toLocaleString()}
          </span>
          {pageList(page, pages).map((p, i) =>
            p === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
              <span key={`gap${i}`} className="hidden px-1 type-meta text-muted sm:inline">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={cx("tabular hidden h-8 min-w-8 rounded-md px-2 type-meta sm:inline-block", p === page ? "bg-ink text-raised" : "text-muted hover:bg-inset hover:text-ink")}
              >
                {p.toLocaleString()}
              </button>
            ),
          )}
          <Button size="sm" variant="ghost" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">
            Next ›
          </Button>
        </div>
      )}
    </nav>
  );
}
