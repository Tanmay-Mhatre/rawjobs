import { type FacetOption, type Filters, INDEX_MAX_AGE_DAYS } from "../../lib/filters";
import { settingsHash } from "../settings/registry";
import { FacetMenu } from "./FacetMenu";

/** "3 months", "1 month", "60 days". */
export const ageLimit = (days: number) => (days % 30 === 0 ? (days === 30 ? "1 month" : `${days / 30} months`) : `${days} days`);

export function MoreToggles({ filters, setFilters, olderCount, maxAgeDays }: { filters: Filters; setFilters: (p: Partial<Filters>) => void; olderCount: number; maxAgeDays: number }) {
  const rows: [keyof Filters, string][] = [
    ["salaryOnly", "Salary listed"],
    ["hideEvergreen", "No talent pools or stale jobs"],
    ["visaOnly", "Only companies that sponsor visas"],
    ...(maxAgeDays ? [["showOld", `Show older jobs${olderCount ? ` (${olderCount})` : ""}: posted over ${ageLimit(maxAgeDays)} ago`] as [keyof Filters, string]] : []),
    ["showFailed", "Include jobs that failed your filters"],
    ["showClosed", "Include closed jobs"],
    ["showHidden", "Include hidden jobs and companies"],
    ["olderIndex", `Include not-yet-scanned jobs older than ${INDEX_MAX_AGE_DAYS} days`],
  ];
  return (
    <div className="space-y-0.5">
      {rows.map(([k, label]) => (
        <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 type-small hover:bg-inset">
          <input type="checkbox" checked={filters[k] as boolean} onChange={(e) => setFilters({ [k]: e.target.checked })} className="size-4 accent-ink" />
          {label}
        </label>
      ))}
    </div>
  );
}

export function MoreMenu({
  filters,
  setFilters,
  ats,
  olderCount,
  maxAgeDays,
  hiddenCompanies,
  hideRules,
}: {
  filters: Filters;
  setFilters: (p: Partial<Filters>) => void;
  ats: FacetOption[];
  olderCount: number;
  maxAgeDays: number;
  /** How many companies and Not interested rules hide jobs; each links to where they're managed. */
  hiddenCompanies: number;
  hideRules: number;
}) {
  const extra =
    [filters.salaryOnly, filters.hideEvergreen, filters.visaOnly, filters.showOld, filters.showFailed, filters.showClosed, filters.showHidden, filters.olderIndex].filter(Boolean).length +
    filters.ats.length;
  return (
    <FacetMenu
      label={extra ? `More · ${extra}` : "More"}
      options={ats.length > 1 ? ats : []}
      optionsLabel="Hiring system"
      selected={filters.ats}
      onChange={(v) => setFilters({ ats: v })}
      footer={
        <div className="mt-1 border-t border-line pt-1">
          <MoreToggles filters={filters} setFilters={setFilters} olderCount={olderCount} maxAgeDays={maxAgeDays} />
          {(hiddenCompanies > 0 || hideRules > 0) && (
            <div className="mt-1 space-y-1 border-t border-line px-2 py-2 type-small">
              {hiddenCompanies > 0 && (
                <a href="#companies" className="flex items-center justify-between gap-2 text-muted hover:text-ink">
                  <span>
                    Hidden companies <span className="tabular">({hiddenCompanies})</span>
                  </span>
                  <span className="font-medium text-ink underline underline-offset-2">Manage</span>
                </a>
              )}
              {hideRules > 0 && (
                <a href={`#${settingsHash("rules")}`} className="flex items-center justify-between gap-2 text-muted hover:text-ink">
                  <span>
                    Not interested rules <span className="tabular">({hideRules})</span>
                  </span>
                  <span className="font-medium text-ink underline underline-offset-2">Manage</span>
                </a>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}
