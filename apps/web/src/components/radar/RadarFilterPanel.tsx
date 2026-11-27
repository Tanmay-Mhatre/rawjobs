import type { ReactNode } from "react";
import type { FacetKey, Filters } from "../../lib/filters";
import { Button } from "../ui";
import { FacetMenu } from "./FacetMenu";
import { type FacetCounts, FACETS, facetOptions } from "./facetTable";
import { MoreMenu } from "./MoreFilters";

/** The first row holds the common facets; the rest show on request ("More filters"). */
const FIRST: FacetKey[] = ["posted", "countries", "locations", "workplace", "employment", "match"];
const MORE: FacetKey[] = ["seniority", "industries", "companies", "topics"];

export type MoreFilterProps = {
  olderCount: number;
  maxAgeDays: number;
  hiringReady?: boolean;
  networkReady: boolean;
  knownCount: number;
};

/** Laptops and up: the filter row under the search, opened with Filters. */
export function RadarFilterPanel(
  p: {
    /** Your profile line, when it isn't shown above the toolbar. */
    profileBar?: ReactNode;
    filters: Filters;
    setFilters: (patch: Partial<Filters>) => void;
    counts: FacetCounts;
    moreFacets: boolean;
    onMoreFacets: () => void;
    hiddenCompanies: number;
    hideRules: number;
  } & MoreFilterProps,
) {
  const { filters, setFilters, counts } = p;
  const menu = (key: FacetKey) => {
    const f = FACETS[key];
    return <FacetMenu key={key} label={f.label} single={f.single} searchable={f.searchable} options={facetOptions(counts, key)} selected={f.get(filters)} onChange={(v) => setFilters(f.set(v))} />;
  };
  return (
    <div id="radar-filters" className="mt-3 space-y-2 border-t border-hairline pt-3">
      {p.profileBar}
      <div className="flex flex-wrap items-center gap-1.5">
        {FIRST.map(menu)}
        {/* The rest on request; one that's filtering something always shows. */}
        {MORE.filter((key) => (p.moreFacets || FACETS[key].get(filters).length > 0) && (!FACETS[key].hideEmpty || facetOptions(counts, key).length > 0)).map(menu)}
        <MoreMenu
          filters={filters}
          setFilters={setFilters}
          ats={facetOptions(counts, "ats")}
          olderCount={p.olderCount}
          maxAgeDays={p.maxAgeDays}
          hiddenCompanies={p.hiddenCompanies}
          hideRules={p.hideRules}
          hiringReady={p.hiringReady}
          networkReady={p.networkReady}
          knownCount={p.knownCount}
        />
        <Button variant="ghost" size="sm" aria-expanded={p.moreFacets} onClick={p.onMoreFacets}>
          {p.moreFacets ? "Fewer filters" : "More filters"}
        </Button>
      </div>
    </div>
  );
}
