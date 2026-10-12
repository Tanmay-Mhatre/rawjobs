import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Filters, Sort } from "../../lib/filters";
import { Dialog } from "../Dialog";
import { IconButton } from "../primitives";
import { Button, cx } from "../ui";

/** The sort choices, in the toolbar's select and the phone sheet. */
export const SORTS: { value: Sort; label: string }[] = [
  { value: "best", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "salary", label: "Highest salary" },
  { value: "company", label: "Company A–Z" },
];

// ---------- phone filter sheet ----------

export function FilterSheet({ children, count, onClose, onClear }: { children: ReactNode; count: number; onClose: () => void; onClear: () => void }) {
  return (
    <Dialog open onClose={onClose} labelledBy="filter-sheet-title" placement="bottom">
      <div className="flex max-h-[85dvh] flex-col rounded-t-md border border-line bg-raised shadow-l3 sm:rounded-md">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="filter-sheet-title" className="type-body font-semibold">
            Filters
          </h2>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear all
            </Button>
            <IconButton label="Close" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
        <footer className="border-t border-line p-3">
          <Button variant="primary" className="w-full" onClick={onClose}>
            Show {count} {count === 1 ? "job" : "jobs"}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

/** The sort choices in the phone filter sheet: one always picked, styled like the single-choice filters. */
export function SortOptions({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }) {
  return (
    <ul>
      {SORTS.map((s) => {
        const on = s.value === sort;
        return (
          <li key={s.value}>
            <button type="button" aria-pressed={on} onClick={() => onChange(s.value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-small hover:bg-inset">
              <span className={cx("flex size-4 shrink-0 items-center justify-center rounded-dot border", on ? "border-ink bg-ink text-raised" : "border-control")}>
                {on && <Check className="size-3" />}
              </span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 type-label">{label}</h3>
      {children}
    </section>
  );
}
