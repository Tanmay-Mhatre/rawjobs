import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { type Filters, sameFilters, type Sort } from "../../lib/filters";
import type { SavedView } from "../../lib/prefs";
import { IconButton, Menu } from "../primitives";
import { cx } from "../ui";

/**
 * The quick filters as chips that stack: each turns one filter field on or off and leaves the rest
 * (search, the Filters panel) as it is, so "New" + "Strong" is new strong jobs. They are the same fields
 * the Filters panel shows, so the two always agree.
 */
const CHIPS: { id: ChipId; label: string; on: (f: Filters) => boolean; set: (on: boolean, base: Filters) => Partial<Filters> }[] = [
  { id: "mine", label: "My companies", on: (f) => !!f.mine, set: (on) => ({ mine: on }) },
  { id: "new", label: "New", on: (f) => f.status === "new", set: (on, base) => ({ status: on ? "new" : base.status }) },
  { id: "strong", label: "Strong", on: (f) => f.match === "strong", set: (on, base) => ({ match: on ? "strong" : base.match }) },
];
export type ChipId = "mine" | "new" | "strong";

export type ViewCounts = Record<ChipId, number>;

/**
 * The chips keys 1-3 toggle, in the order they show. The first scan has no New chip (every job would be
 * new), so Strong moves up to 2. Saved and applied jobs live on the Pipeline, not here.
 */
export function chipKeys(hideNew?: boolean): ChipId[] {
  return CHIPS.filter((c) => !(c.id === "new" && hideNew)).map((c) => c.id);
}

/** The filters with one chip turned the other way. */
export function toggleChip(filters: Filters, base: Filters, id: ChipId): Filters {
  const chip = CHIPS.find((c) => c.id === id)!;
  return { ...filters, ...chip.set(!chip.on(filters), base) };
}

export function ViewsBar(props: {
  className?: string;
  /** Your profile's filters: a chip turned off goes back to them. */
  base: Filters;
  filters: Filters;
  sort: Sort;
  views: SavedView[];
  /** Each chip's count with the other chips that are on. */
  counts: ViewCounts;
  /** First scan: every job would be new, so there's no New chip. */
  hideNew?: boolean;
  onPick: (f: Filters, s: Sort) => void;
  onSave: (name: string) => SavedView;
  onRename: (id: string, name: string) => void;
  onDelete: (view: SavedView) => void;
}) {
  const [naming, setNaming] = useState<{ id?: string; value: string } | null>(null);
  const matchesView = (f: Filters) => sameFilters(f, props.filters);
  const customActive = props.views.find((v) => matchesView(v.filters) && v.sort === props.sort);
  const submit = () => {
    if (!naming?.value.trim()) return setNaming(null);
    if (naming.id) props.onRename(naming.id, naming.value);
    else props.onSave(naming.value);
    setNaming(null);
  };

  const chips = CHIPS.filter((c) => !(c.id === "new" && props.hideNew));
  const keys = chipKeys(props.hideNew);
  // Anything other than your profile's own list (in Best match) can be kept as a view.
  const canSave = !customActive && (!sameFilters(props.base, props.filters) || props.sort !== "best");
  const menuLabel = customActive?.name ?? "Views";
  return (
    // One wrapping row for the chips and Views, so a phone needs two rows, not three.
    // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: a fieldset would change the layout
    <div role="group" aria-label="Quick filters" className={cx("flex flex-wrap items-center gap-2", props.className)}>
      {chips.map((c) => {
        const on = c.on(props.filters);
        const key = String(keys.indexOf(c.id) + 1);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            aria-keyshortcuts={key}
            title={`${on ? "Turn off" : "Show only"} ${c.label.toLowerCase()} (${key})`}
            onClick={() => props.onPick(toggleChip(props.filters, props.base, c.id), props.sort)}
            className={cx("rj-chip tabular", on && "border-[var(--chip-on-bg)] bg-[var(--chip-on-bg)] text-[var(--chip-on-fg)]")}
          >
            {c.label}
            <span className={cx("font-normal", on ? "opacity-80" : "text-muted")}>{props.counts[c.id].toLocaleString()}</span>
            {on && <X className="size-3.5 shrink-0" aria-hidden />}
          </button>
        );
      })}
      {naming ? (
        <NameInput value={naming.value} onChange={(value) => setNaming({ ...naming, value })} onSubmit={submit} onCancel={() => setNaming(null)} />
      ) : (
        // Your own views, and saving the current one; nothing to show until there's one or the other.
        (props.views.length > 0 || canSave || customActive) && (
          <Menu
            label="Views"
            align="start"
            trigger={(t) => (
              <button type="button" {...t} className={cx("rj-chip max-w-48 border-dashed", customActive && "border-solid border-[var(--chip-on-bg)] bg-[var(--chip-on-bg)] text-[var(--chip-on-fg)]")}>
                <span className="truncate">{menuLabel}</span>
                <ChevronDown className="size-3.5 shrink-0" aria-hidden />
              </button>
            )}
            items={[
              ...props.views.map((v) => ({ id: v.id, label: v.name, onSelect: () => props.onPick(v.filters, v.sort) })),
              ...(props.views.length && (canSave || customActive) ? [{ separator: true as const, id: "sep" }] : []),
              ...(canSave ? [{ id: "save", label: "Save current view…", onSelect: () => setNaming({ value: "" }) }] : []),
              ...(customActive
                ? [
                    { id: "rename", label: `Rename "${customActive.name}"…`, onSelect: () => setNaming({ id: customActive.id, value: customActive.name }) },
                    { id: "delete", label: `Delete "${customActive.name}"`, danger: true, onSelect: () => props.onDelete(customActive) },
                  ]
                : []),
            ]}
          />
        )
      )}
    </div>
  );
}

function NameInput({ value, onChange, onSubmit, onCancel }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: focus moves into what was just opened (a menu, a dialog field), as the pattern expects
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => (e.key === "Enter" ? onSubmit() : e.key === "Escape" && onCancel())}
        placeholder="Name this view"
        aria-label="View name"
        className="h-8 w-40 rounded-md border border-control bg-raised px-2 type-small"
      />
      <IconButton label="Save view name" size="sm" onClick={onSubmit}>
        <Check className="rj-icon" aria-hidden />
      </IconButton>
    </span>
  );
}
