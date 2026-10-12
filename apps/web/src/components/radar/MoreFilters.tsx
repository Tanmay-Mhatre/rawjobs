import { type FacetOption, type Filters, INDEX_MAX_AGE_DAYS } from "../../lib/filters";
import { type HideRule, offerWhat, ruleKey, ruleLabel } from "../../lib/notForMe";
import { Button } from "../ui";
import { FacetMenu } from "./FacetMenu";

/** "3 months", "1 month", "60 days". */
export const ageLimit = (days: number) => (days % 30 === 0 ? (days === 30 ? "1 month" : `${days / 30} months`) : `${days} days`);

export function MoreToggles({ filters, setFilters, olderCount, maxAgeDays }: { filters: Filters; setFilters: (p: Partial<Filters>) => void; olderCount: number; maxAgeDays: number }) {
  const rows: [keyof Filters, string][] = [
    ["salaryOnly", "Salary listed"],
    ["hideEvergreen", "No talent pools or reposts"],
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
  onUnhide,
  hideRules,
  onRemoveRule,
}: {
  filters: Filters;
  setFilters: (p: Partial<Filters>) => void;
  ats: FacetOption[];
  olderCount: number;
  maxAgeDays: number;
  hiddenCompanies: string[];
  onUnhide: (company: string) => void;
  hideRules: HideRule[];
  onRemoveRule: (rule: HideRule) => void;
}) {
  const extra =
    [filters.salaryOnly, filters.hideEvergreen, filters.showOld, filters.showFailed, filters.showClosed, filters.showHidden, filters.olderIndex].filter(Boolean).length + filters.ats.length;
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
          {hiddenCompanies.length > 0 && (
            <div className="mt-1 border-t border-line px-2 pt-2">
              <p className="mb-1 type-label">Hidden companies</p>
              <ul className="space-y-0.5">
                {hiddenCompanies.map((c) => (
                  <li key={c} className="flex items-center justify-between type-small">
                    <span className="truncate">{c}</span>
                    <Button size="sm" variant="ghost" onClick={() => onUnhide(c)} aria-label={`Show ${c} again`}>
                      Show
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hideRules.length > 0 && (
            <div className="mt-1 border-t border-line px-2 pt-2">
              <p className="mb-1 type-label">Hidden by your Not interested rules</p>
              <ul className="space-y-0.5">
                {hideRules.map((r) => (
                  <li key={ruleKey(r)} className="flex items-center justify-between gap-2 type-small">
                    <span className="min-w-0 truncate">{ruleLabel(r)}</span>
                    <Button size="sm" variant="ghost" onClick={() => onRemoveRule(r)} aria-label={`Show ${offerWhat({ kind: "rule", rule: r })} again`}>
                      Show
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    />
  );
}
