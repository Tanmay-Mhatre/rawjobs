import { Check } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { cx } from "../../lib/cx";

/** `done`: a check in place of the count, named for screen readers by this text ("all in My companies"). */
export type TabItem<T extends string> = { id: T; label: string; count?: number; done?: string };

/**
 * design/components/Tabs: views of one list. Roving tabindex (only the selected tab is in the tab
 * order); arrow keys, Home and End move between tabs and select them. The 1-6 shortcuts are the app's.
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  idPrefix = "tab",
  panelId,
  className,
  wrap,
}: {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Tab ids are `${idPrefix}-${id}`, so a panel can point back with aria-labelledby. */
  idPrefix?: string;
  /** The panel these tabs control. */
  panelId?: string;
  className?: string;
  /** Wrap onto more lines instead of scrolling sideways (rj-tabs--wrap): for a few long labels that must all stay visible. */
  wrap?: boolean;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined || !items.length) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length]!;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  // With no tab selected (e.g. a saved view is showing), the first tab keeps the list reachable by Tab.
  const anySelected = items.some((t) => t.id === value);
  return (
    <div className={cx("rj-tabs", wrap && "rj-tabs--wrap", className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((t, i) => {
        const selected = t.id === value;
        const tabbable = selected || (!anySelected && i === 0);
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            id={`${idPrefix}-${t.id}`}
            type="button"
            role="tab"
            className="rj-tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.done ? <Check className="size-3.5 shrink-0" role="img" aria-label={t.done} /> : t.count != null && <span className="rj-tab__count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
