import type { FacetKey, Filters, Sort } from "../../lib/filters";
import { OptionList } from "./FacetMenu";
import { type FacetCounts, FACETS, facetOptions } from "./facetTable";
import { FilterSheet, SheetSection, SortOptions } from "./FilterSheet";
import { MoreToggles } from "./MoreFilters";
import type { MoreFilterProps } from "./RadarFilterPanel";

/** Every facet, in the sheet's order. */
const ORDER: FacetKey[] = ["posted", "countries", "locations", "workplace", "employment", "seniority", "industries", "match", "companies", "topics"];

/** Phones: sort and every filter in one sheet. */
export function RadarFilterSheet(
  p: {
    onClose: () => void;
    count: number;
    onClear: () => void;
    sort: Sort;
    setSort: (s: Sort) => void;
    filters: Filters;
    setFilters: (patch: Partial<Filters>) => void;
    counts: FacetCounts;
  } & MoreFilterProps,
) {
  const { filters, setFilters, counts } = p;
  const section = (key: FacetKey) => {
    const f = FACETS[key];
    return (
      <SheetSection key={key} label={f.label}>
        <OptionList label={f.label} single={f.single} searchable={f.searchable} options={facetOptions(counts, key)} selected={f.get(filters)} onChange={(v) => setFilters(f.set(v))} />
      </SheetSection>
    );
  };
  return (
    <FilterSheet onClose={p.onClose} count={p.count} onClear={p.onClear}>
      <SheetSection label="Sort by">
        <SortOptions sort={p.sort} onChange={p.setSort} networkReady={p.networkReady} />
      </SheetSection>
      {ORDER.filter((key) => !FACETS[key].hideEmpty || facetOptions(counts, key).length > 0).map(section)}
      <SheetSection label="More">
        <MoreToggles
          filters={filters}
          setFilters={setFilters}
          olderCount={p.olderCount}
          maxAgeDays={p.maxAgeDays}
          hiringReady={p.hiringReady}
          networkReady={p.networkReady}
          knownCount={p.knownCount}
        />
      </SheetSection>
      {facetOptions(counts, "ats").length > 1 && section("ats")}
    </FilterSheet>
  );
}
