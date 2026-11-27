import { companyIndex, companyMatches, type CompanyIndex, MATCH } from "./company-search";
import { isPlaceholderBoard } from "./text";
import { type DirCompany, groupBoards, SUPPORTED } from "./directory-boards";

/**
 * Browse and search the company directory (data/catalog/directory.json): one implementation for the
 * page (hosted build) and the local server's search process (`rawjobs directory search --serve`).
 */

// Kept importable from here (the server and older imports use this path).
export { ATS_LABEL, type BoardGroup, type CompanyRef, countCompanies, type DirCompany, groupBoards, SUPPORTED } from "./directory-boards";

/**
 * Directory search, one row per company (its other careers pages fold under it), each with how it matched
 * (`rank`, MATCH). Browsing lists companies with open jobs; a search finds any, and yours always show. The
 * search looks at names only, never careers addresses (companyMatches): the exact name first, then names
 * that start with it, then names that contain it, then close spellings; within each, the best fit for your
 * profile, then the biggest. Sandbox and test boards never show (unless one is already in My companies).
 */
export function searchDirectory(
  all: readonly DirCompany[],
  o: {
    q: string;
    watched: ReadonlySet<string>;
    fit?: ReadonlyMap<string, number>;
    system?: "all" | "supported" | "soon";
    industry?: string;
    /** The directory's search index (companyIndex); built here when not given. */
    index?: CompanyIndex<DirCompany>;
  },
) {
  const s = o.q.trim().toLowerCase();
  const matches = s ? companyMatches(o.index ?? companyIndex(all), s) : undefined;
  const rank = (c: DirCompany) => matches?.get(c) ?? 0;
  const system = o.system ?? "all";
  const sorted = all
    .filter((c) => o.watched.has(c.key) || !isPlaceholderBoard(c.name))
    .filter((c) => c.status === "live" || !!s || o.watched.has(c.key))
    .filter((c) => system === "all" || (system === "supported") === SUPPORTED.has(c.ats))
    .filter((c) => !o.industry || !!c.tags?.includes(o.industry) || !!c.title_tags?.includes(o.industry))
    .filter((c) => !matches || matches.has(c))
    .sort((a, b) => rank(a) - rank(b) || (o.fit?.get(b.key) ?? 0) - (o.fit?.get(a.key) ?? 0) || (b.open_jobs ?? 0) - (a.open_jobs ?? 0));
  return groupBoards(sorted, new Set(o.watched)).map((g) => ({ ...g, rank: Math.min(rank(g.lead), ...g.others.map(rank)) }));
}

// ---------- Browse all, a page at a time ----------

/** What the page asks for: the header search, the two filters, a page, and what orders the results. */
export type BrowseRequest = {
  q: string;
  industry: string;
  system: "all" | "supported" | "soon";
  page: number;
  pageSize: number;
  /** Keys of the companies in your list: always shown, never folded away. */
  watched: string[];
  /** Fit score per company key, from the suggestions (orders results, never shown). */
  fit: Record<string, number>;
  /** Leave out companies with a careers page in `watched` (My companies' "N more in the directory"). */
  hideWatched: boolean;
};

export type BrowseGroup = { lead: DirCompany; others: DirCompany[]; rank: number };

export type BrowseAnswer =
  | { missing: true }
  | {
      missing?: false;
      rows: BrowseGroup[];
      /** Companies matching (one per company, not per careers page). */
      total: number;
      /** How many of them match the search exactly (MATCH.exact); 0 without a search. */
      exact: number;
      page: number;
      pageSize: number;
      /** False until the search index is built (a search waits for it the first time). */
      searchReady: boolean;
    };

const SYSTEMS = new Set(["all", "supported", "soon"]);
export const MAX_KEYS = 50_000;

/** A request from the page, made safe: anything missing or odd falls back to the plain first page. */
export function cleanBrowseRequest(raw: unknown): BrowseRequest {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const int = (v: unknown, min: number, max: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : dflt);
  const watched = Array.isArray(o.watched) ? o.watched.filter((k): k is string => typeof k === "string").slice(0, MAX_KEYS) : [];
  const fit: Record<string, number> = {};
  if (o.fit && typeof o.fit === "object") {
    for (const [k, v] of Object.entries(o.fit as Record<string, unknown>).slice(0, MAX_KEYS)) if (typeof v === "number" && Number.isFinite(v)) fit[k] = v;
  }
  return {
    q: str(o.q, 200),
    industry: str(o.industry, 80),
    system: SYSTEMS.has(o.system as string) ? (o.system as BrowseRequest["system"]) : "all",
    page: int(o.page, 1, 100_000, 1),
    pageSize: int(o.pageSize, 1, 100, 25),
    watched,
    fit,
    hideWatched: o.hideWatched === true,
  };
}

/** One page of grouped results (pure: the page's hosted build answers with this too). */
export function pageOf(results: readonly BrowseGroup[], r: Pick<BrowseRequest, "q" | "page" | "pageSize">, searchReady: boolean): BrowseAnswer {
  const pages = Math.max(1, Math.ceil(results.length / r.pageSize));
  const page = Math.min(r.page, pages);
  return {
    rows: results.slice((page - 1) * r.pageSize, page * r.pageSize),
    total: results.length,
    exact: r.q.trim() ? results.filter((g) => g.rank === MATCH.exact).length : 0,
    page,
    pageSize: r.pageSize,
    searchReady,
  };
}
