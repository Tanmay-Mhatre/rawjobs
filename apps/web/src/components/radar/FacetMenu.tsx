import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { FacetOption } from "../../lib/filters";
import { cx } from "../ui";

type Props = {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** One choice at a time (e.g. "Posted"). */
  single?: boolean;
  /** Show a search box (long lists such as companies). */
  searchable?: boolean;
  /** Extra controls under the options (e.g. toggles in "More"). */
  footer?: ReactNode;
  /** A heading over the options when the button's label doesn't name them (e.g. "Hiring system" in "More"). */
  optionsLabel?: string;
};

/**
 * A filter button that opens a popover of options with counts. Counts reflect the other active filters.
 * Plain popover (not an ARIA menu): Tab moves through it; Escape, a click outside or tabbing away closes it.
 */
export function FacetMenu({ label, options, selected, onChange, single, searchable, footer, optionsLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape from inside the popover puts focus back on its button.
      if (ref.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = selected.length > 0;
  const summary = active
    ? single
      ? options.find((o) => o.value === selected[0])?.label
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${label} · ${selected.length}`
    : label;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover, focus or drop handling around real controls; nothing here is only reachable by mouse
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cx(
          // Looks like a filter chip (design/components/Chip): inverted while it filters something.
          "rj-chip max-w-56",
          active && "border-[var(--chip-on-bg)] bg-[var(--chip-on-bg)] text-[var(--chip-on-fg)] hover:bg-[var(--chip-on-bg)] hover:text-[var(--chip-on-fg)]",
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className={cx("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here
        <div id={panelId} role="group" aria-label={label} className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-line bg-raised p-1.5 shadow-l3">
          {optionsLabel && options.length > 0 && <p className="px-2 pb-0.5 pt-1 type-label">{optionsLabel}</p>}
          <OptionList label={label} options={options} selected={selected} onChange={onChange} single={single} searchable={searchable} autoFocus />
          {footer}
          {active && (
            <div className="mt-1 border-t border-line pt-1 text-right">
              <button type="button" className="rj-btn rj-btn--quiet rj-btn--sm" onClick={() => onChange([])}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Checkbox (or radio) rows with counts; used by the filter menus and the phone filter sheet. */
export function OptionList({
  label,
  options,
  selected,
  onChange,
  single,
  searchable,
  autoFocus,
}: Pick<Props, "label" | "options" | "selected" | "onChange" | "single" | "searchable"> & { autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const toggle = (v: string) => onChange(single ? (selected.includes(v) ? [] : [v]) : selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {searchable && (
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted" />
          <input
            // biome-ignore lint/a11y/noAutofocus: focus moves into what was just opened (a menu, a dialog field), as the pattern expects
            autoFocus={autoFocus}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="h-8 w-full rounded-md border border-line bg-raised pl-8 pr-2 type-small"
          />
        </div>
      )}
      <ul className="max-h-72 overflow-y-auto">
        {shown.map((o, i) => {
          const on = selected.includes(o.value);
          // Headings when options are split into yours (from your profile) and the rest.
          const heading = o.group && o.group !== shown[i - 1]?.group ? (o.group === "yours" ? "From your profile" : "Also mentioned in jobs") : null;
          return (
            <li key={o.value}>
              {heading && <p className="px-2 pb-0.5 pt-2 type-label first:pt-0.5">{heading}</p>}
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.value)}
                disabled={!on && o.count === 0}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-small hover:bg-inset disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span className={cx("flex size-4 shrink-0 items-center justify-center border", single ? "rounded-dot" : "rounded-sm", on ? "border-ink bg-ink text-raised" : "border-control")}>
                  {on && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className="tabular type-meta text-muted">{o.count}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-3 type-small text-muted">Nothing here with the current filters.</li>}
      </ul>
    </>
  );
}
