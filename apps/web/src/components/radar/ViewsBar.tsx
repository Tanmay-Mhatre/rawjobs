import { Check, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { type Filters, sameFilters, type Sort } from "../../lib/filters";
import type { SavedView } from "../../lib/prefs";
import { IconButton, Menu, Tabs } from "../primitives";
import { Button, cx } from "../ui";

const BUILT_IN: { id: string; label: string; filters: Partial<Filters>; count: keyof ViewCounts }[] = [
  { id: "all", label: "All", filters: {}, count: "all" },
  { id: "mine", label: "My companies", filters: { mine: true }, count: "mine" },
  { id: "new", label: "New", filters: { status: "new" }, count: "new" },
  { id: "strong", label: "Strong", filters: { match: "strong" }, count: "strong" },
  { id: "saved", label: "Saved", filters: { status: "saved" }, count: "saved" },
  { id: "applied", label: "Applied", filters: { status: "applied" }, count: "applied" },
];
/** The built-in views in tab order; the first scan has no New view (every job would be new). Keys 1-6 pick them. */
export const builtInViews = (hideNew?: boolean) => BUILT_IN.filter((b) => !(b.id === "new" && hideNew));
export type ViewCounts = { all: number; mine: number; new: number; strong: number; saved: number; applied: number };

export function ViewsBar(props: {
  className?: string;
  /** Your profile's filters: the built-in views start from them. */
  base: Filters;
  filters: Filters;
  sort: Sort;
  views: SavedView[];
  counts: ViewCounts;
  /** First scan: every job would be new, so there's no New view. */
  hideNew?: boolean;
  onPick: (f: Filters, s: Sort) => void;
  onSave: (name: string) => SavedView;
  onRename: (id: string, name: string) => void;
  onDelete: (view: SavedView) => void;
}) {
  const [naming, setNaming] = useState<{ id?: string; value: string } | null>(null);
  const matchesView = (f: Filters) => sameFilters(f, props.filters);
  const builtInActive = BUILT_IN.find((b) => matchesView({ ...props.base, ...b.filters }));
  const customActive = props.views.find((v) => matchesView(v.filters) && v.sort === props.sort);
  const submit = () => {
    if (!naming?.value.trim()) return setNaming(null);
    if (naming.id) props.onRename(naming.id, naming.value);
    else props.onSave(naming.value);
    setNaming(null);
  };

  /** Something worth saving: not a saved view already, and not just a built-in tab in Best match. */
  const canSave = !customActive && (!builtInActive || props.sort !== "best");
  const builtIns = builtInViews(props.hideNew);
  const tabValue = builtInActive && !customActive ? builtInActive.id : "";
  return (
    <div className={cx("flex flex-wrap items-end gap-x-4 gap-y-2 lg:flex-nowrap", props.className)}>
      {/* design/components/Tabs: views of one list, ink underline. */}
      <Tabs
        label="Radar views"
        idPrefix="view"
        className="min-w-0 flex-1"
        value={tabValue}
        onChange={(id) => {
          const b = builtIns.find((x) => x.id === id);
          if (b) props.onPick({ ...props.base, ...b.filters }, props.sort);
        }}
        items={builtIns.map((b) => ({ id: b.id, label: b.label, count: props.counts[b.count] }))}
      />
      {naming ? (
        <div className="flex items-center pb-1">
          <NameInput value={naming.value} onChange={(value) => setNaming({ ...naming, value })} onSubmit={submit} onCancel={() => setNaming(null)} />
        </div>
      ) : props.views.length > 0 ? (
        // Your saved views in one menu, so the row keeps room for the built-in tabs.
        <div className="flex items-center pb-1">
          <Menu
            label="Saved views"
            align="end"
            trigger={(t) => (
              <button type="button" {...t} className={cx("rj-chip max-w-48", customActive && "border-[var(--chip-on-bg)] bg-[var(--chip-on-bg)] text-[var(--chip-on-fg)]")}>
                <span className="truncate">{customActive ? customActive.name : "Views"}</span>
                <ChevronDown className="size-3.5 shrink-0" aria-hidden />
              </button>
            )}
            items={[
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
        </div>
      ) : (
        canSave && (
          <div className="flex items-center pb-1">
            <Button size="sm" variant="ghost" onClick={() => setNaming({ value: "" })}>
              <Plus className="rj-icon" aria-hidden /> Save view
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function NameInput({ value, onChange, onSubmit, onCancel }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <input
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
