import type { ScanPlan, ScanScope } from "./setup";

/** The Companies page's three tabs. */
export type CompaniesTabId = "mine" | "suggestions" | "browse";
export const COMPANIES_TABS: readonly CompaniesTabId[] = ["mine", "suggestions", "browse"];

/**
 * The tab the Companies page opens on, decided once the saved setup has loaded (before that the
 * company count is a blank draft's 0). A followed "failing" link opens My companies; with no
 * companies it's always Suggestions, whatever tab was remembered; otherwise the remembered tab.
 */
export function initialCompaniesTab({ attention, stored, companies }: { attention: boolean; stored: string | null; companies: number }): CompaniesTabId {
  if (attention) return "mine";
  if (companies === 0) return "suggestions";
  return COMPANIES_TABS.includes(stored as CompaniesTabId) ? (stored as CompaniesTabId) : "mine";
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * What your usual scan covers right now, in one line, from GET /api/scan/plan (the saved config):
 * "Right now: your 12 companies plus 175 with likely matches." `yours` are your companies a scan
 * always fetches; `extra` the directory ones Scan now adds (companies that matched you before, and
 * the ones the shared job feed has new jobs for you at). `hasJobs`: the Radar still holds jobs from
 * earlier scans, so with nothing covered it doesn't "stay empty", it just gets nothing new.
 * (`industries` is kept for older callers: your industries only rank jobs now.)
 */
export function coverageLine({ plan, scope, hasJobs }: { plan: ScanPlan; scope: ScanScope; industries?: number; hasJobs: boolean }): string {
  const { yours, extra } = plan[scope] ?? plan.mine;
  const mine = count(yours, "company", "companies");
  if (scope === "all") return yours ? `Right now: your ${mine} plus ${extra.toLocaleString()} more from the directory.` : `Right now: ${count(extra, "company", "companies")} from the directory.`;
  const more = scope === "yours" ? 0 : extra;
  if (yours && more) return `Right now: your ${mine} plus ${more.toLocaleString()} with likely matches.`;
  if (yours) return `Right now: your ${mine}.`;
  if (more) return `Right now: ${count(more, "company", "companies")} with likely matches. Add companies to always check them.`;
  return hasJobs ? "Right now: 0 companies, so scans find no new jobs." : "Right now: 0 companies, so your Radar stays empty.";
}
