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

/** Saved and Applied: pipeline states, one at a time, in the Views menu with your own views. */
const MENU_VIEWS: { id: "saved" | "applied"; label: string; filters: Partial<Filters> }[] = [
  { id: "saved", label: "Saved", filters: { status: "saved" } },
  { id: "applied", label: "Applied", filters: { status: "applied" } },
];

export type ViewCounts = Record<ChipId | "saved" | "applied", number>;

/**
 * What keys 1-5 do, in the order they show: the chips (toggled), then Saved and Applied (picked). The
 * first scan has no New chip (every job would be new), so the keys after it move up one.
 */
export function viewKeys(hideNew?: boolean): ({ kind: "chip"; id: ChipId } | { kind: "view"; filters: Partial<Filters> })[] {
  return [...CHIPS.filter((c) => !(c.id === "new" && hideNew)).map((c) => ({ kind: "chip" as const, id: c.id })), ...MENU_VIEWS.map((v) => ({ kind: "view" as const, filters: v.filters }))];
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
  /** Each chip's count with the other chips that are on; Saved and Applied on their own. */
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
  const menuActive = MENU_VIEWS.find((v) => matchesView({ ...props.base, ...v.filters }));
  const customActive = props.views.find((v) => matchesView(v.filters) && v.sort === props.sort);
  const submit = () => {
    if (!naming?.value.trim()) return setNaming(null);
    if (naming.id) props.onRename(naming.id, naming.value);
    else props.onSave(naming.value);
    setNaming(null);
  };

  const chips = CHIPS.filter((c) => !(c.id === "new" && props.hideNew));
  const keys = viewKeys(props.hideNew);
  const keyOf = (match: (k: ReturnType<typeof viewKeys>[number]) => boolean) => String(keys.findIndex(match) + 1);
  // Anything other than your profile's own list (in Best match) can be kept as a view.
  const canSave = !customActive && !menuActive && (!sameFilters(props.base, props.filters) || props.sort !== "best");
  const menuLabel = customActive?.name ?? menuActive?.label ?? "Views";
  return (
    // One wrapping row for the chips and Views, so a phone needs two rows, not three.
    // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: a fieldset would change the layout
    <div role="group" aria-label="Quick filters" className={cx("flex flex-wrap items-center gap-2", props.className)}>
      {chips.map((c) => {
        const on = c.on(props.filters);
        const key = keyOf((k) => k.kind === "chip" && k.id === c.id);
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
        // Saved, Applied and your own views in one menu: one at a time, they replace the chips.
        <Menu
          label="Views"
          align="start"
          trigger={(t) => (
            <button
              type="button"
              {...t}
              className={cx("rj-chip max-w-48 border-dashed", (customActive || menuActive) && "border-solid border-[var(--chip-on-bg)] bg-[var(--chip-on-bg)] text-[var(--chip-on-fg)]")}
            >
              <span className="truncate">{menuLabel}</span>
              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            </button>
          )}
          items={[
            ...MENU_VIEWS.map((v) => ({
              id: v.id,
              label: `${v.label} · ${props.counts[v.id].toLocaleString()}`,
              shortcut: keyOf((k) => k.kind === "view" && k.filters.status === v.filters.status),
              onSelect: () => props.onPick({ ...props.base, ...v.filters }, props.sort),
            })),
            ...(props.views.length ? [{ separator: true as const, id: "sep-views" }] : []),
            ...props.views.map((v) => ({ id: v.id, label: v.name, onSelect: () => props.onPick(v.filters, v.sort) })),
            ...(canSave || customActive ? [{ separator: true as const, id: "sep" }] : []),
            ...(canSave ? [{ id: "save", label: "Save current view…", onSelect: () => setNaming({ value: "" }) }] : []),
            ...(customActive
              ? [
                  { id: "rename", label: `Rename "${customActive.name}"…`, onSelect: () => setNaming({ id: customActive.id, value: customActive.name }) },
                  { id: "delete", label: `Delete "${customActive.name}"`, danger: true, onSelect: () => props.onDelete(customActive) },
                ]
              : []),
          ]}
        />
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
