import { ArrowUpDown, SlidersHorizontal, X } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import type { Filters, Sort } from "../../lib/filters";
import type { SavedView } from "../../lib/prefs";
import { Chip, SearchField } from "../primitives";
import { toast } from "../Toast";
import { Button, Card } from "../ui";
import type { FacetCounts } from "./facetTable";
import { sortsFor } from "./FilterSheet";
import { ageLimit } from "./MoreFilters";
import { type MoreFilterProps, RadarFilterPanel } from "./RadarFilterPanel";
import { type ViewCounts, ViewsBar } from "./ViewsBar";

/**
 * Laptops and up: one row of views, search, sort and Filters, so the feed starts high and the job's Apply stays
 * in view; the filters, active chips and your profile line open under it on request. Phones: search and Filters
 * (which opens the sheet), with the views under them.
 */
export function RadarToolbar({
  searchRef,
  ...p
}: {
  wide: boolean;
  base: Filters;
  filters: Filters;
  sort: Sort;
  setFilters: (patch: Partial<Filters>) => void;
  setSort: (s: Sort) => void;
  replace: (f: Filters, s: Sort) => void;
  views: SavedView[];
  chipCounts: ViewCounts;
  firstScan: boolean;
  onSaveView: (name: string) => SavedView;
  onRenameView: (id: string, name: string) => void;
  onDeleteView: (id: string) => void;
  /** Undo a delete: put the view back at its old position. */
  onRestoreView: (view: SavedView, index: number) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onOpenSheet: () => void;
  chips: { key: string; label: string; remove: Partial<Filters> }[];
  /** Your profile line, shown in the filter row when it isn't above the toolbar. */
  profileBar?: ReactNode;
  counts: FacetCounts;
  hiddenCompanies: number;
  hideRules: number;
} & MoreFilterProps) {
  const { wide, filters, setFilters, sort, chips, olderCount } = p;
  /** Seniority, industry, company and keywords: shown on request, so the first row holds the common ones. */
  const [moreFacets, setMoreFacets] = useState(false);
  const deleteView = (view: SavedView) => {
    const index = p.views.findIndex((v) => v.id === view.id);
    p.onDeleteView(view.id);
    toast({
      message: (
        <>
          Deleted the view <b>{view.name}</b>.
        </>
      ),
      actionLabel: "Undo",
      onAction: () => p.onRestoreView(view, index),
    });
  };
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:gap-3">
        <ViewsBar
          className="order-3 w-full lg:order-none lg:w-auto lg:min-w-0 lg:flex-1"
          base={p.base}
          filters={filters}
          sort={sort}
          views={p.views}
          counts={p.chipCounts}
          hideNew={p.firstScan}
          onPick={p.replace}
          onSave={p.onSaveView}
          onRename={p.onRenameView}
          onDelete={deleteView}
        />
        <SearchField
          ref={searchRef}
          label="Search jobs"
          className="order-1 min-w-0 flex-1 basis-40 lg:order-none lg:w-44 lg:flex-none lg:basis-auto xl:w-60"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.currentTarget.blur();
            setFilters({ q: "" });
          }}
          placeholder="Search"
        />
        {/* Phones sort in the filter sheet, so search and Filters share one row. */}
        <label className="relative hidden shrink-0 items-center lg:inline-flex">
          <ArrowUpDown className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
          <select value={sort} onChange={(e) => p.setSort(e.target.value as Sort)} aria-label="Sort" className="h-9 appearance-none rounded-md border border-control bg-raised pl-8 pr-3 type-small">
            {sortsFor(p.networkReady, sort).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          className="order-2 shrink-0 lg:order-none"
          aria-expanded={wide ? p.filtersOpen : undefined}
          aria-controls={wide ? "radar-filters" : undefined}
          aria-pressed={chips.length > 0 || undefined}
          onClick={() => (wide ? p.onToggleFilters() : p.onOpenSheet())}
        >
          <SlidersHorizontal className="rj-icon" aria-hidden /> Filters{chips.length ? ` · ${chips.length}` : ""}
        </Button>
      </div>

      {wide && p.filtersOpen && (
        <RadarFilterPanel
          profileBar={p.profileBar}
          filters={filters}
          setFilters={setFilters}
          counts={p.counts}
          moreFacets={moreFacets}
          onMoreFacets={() => setMoreFacets((o) => !o)}
          hiddenCompanies={p.hiddenCompanies}
          hideRules={p.hideRules}
          olderCount={olderCount}
          maxAgeDays={p.maxAgeDays}
          hiringReady={p.hiringReady}
          networkReady={p.networkReady}
          knownCount={p.knownCount}
        />
      )}

      {(chips.length > 0 || olderCount > 0) && (wide ? p.filtersOpen : true) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2">
          {chips.map((c) => (
            // An active filter: pressed; pressing it turns it off.
            <Chip key={c.key} pressed onClick={() => setFilters(c.remove)} aria-label={`Filter: ${c.label}`} title="Remove this filter">
              {c.label} <X className="rj-icon" aria-hidden />
            </Chip>
          ))}
          {chips.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => p.replace(p.base, sort)}>
              Clear all
            </Button>
          )}
          {olderCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters({ showOld: true })}
              title={`Postings older than ${ageLimit(p.maxAgeDays)} are hidden: they're usually filled. Change this in Settings › Matching.`}
            >
              Show older jobs ({olderCount})
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
