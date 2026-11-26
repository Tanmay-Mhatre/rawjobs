import { companyIndex, companyMatches, type CompanyIndex, MATCH } from "./company-search";
import { isPlaceholderBoard } from "./text";

/**
 * Browse and search the company directory (data/catalog/directory.json): one implementation for the
 * page (hosted build) and the local server's search process (`rawjobs directory search --serve`).
 */

export const ATS_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  workable: "Workable",
  recruitee: "Recruitee",
  personio: "Personio",
  bamboohr: "BambooHR",
  breezy: "Breezy HR",
  successfactors: "SAP SuccessFactors",
  teamtailor: "Teamtailor",
  comeet: "Comeet",
  oracle: "Oracle Recruiting",
  icims: "iCIMS",
  taleo: "Taleo",
  jobvite: "Jobvite",
  pinpoint: "Pinpoint",
  rippling: "Rippling",
  jazzhr: "JazzHR",
  zoho: "Zoho Recruit",
  hibob: "HiBob",
  freshteam: "Freshteam",
  join: "JOIN",
  paylocity: "Paylocity",
  paycom: "Paycom",
  hireology: "Hireology",
  ukg: "UKG Pro",
  eightfold: "Eightfold",
  phenom: "Phenom",
  careerplug: "CareerPlug",
  dayforce: "Dayforce",
  adp: "ADP Workforce Now",
  applicantpro: "ApplicantPro",
  paycor: "Paycor",
  hiringthing: "HiringThing",
  manatal: "Manatal",
  trakstar: "Trakstar Hire",
  factorial: "Factorial",
  gem: "Gem",
  hrmdirect: "HRMDirect",
  softgarden: "softgarden",
  cornerstone: "Cornerstone",
  keka: "Keka",
  taleobe: "Taleo Business Edition",
  jobscore: "JobScore",
  avature: "Avature",
  pageup: "PageUp",
  radancy: "Radancy",
  oleeo: "Oleeo",
  jobtrain: "Jobtrain",
  varbi: "Varbi",
  reachmee: "ReachMee",
  jobylon: "Jobylon",
  homerun: "Homerun",
  emply: "Emply",
  bullhorn: "Bullhorn",
  hrmos: "HRMOS",
  herp: "HERP",
  engage: "engage",
  // Job boards: credited by name (Remote OK's terms ask for it), linked back on every job.
  hackernews: "Hacker News",
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  remoteok: "Remote OK",
  himalayas: "Himalayas",
  jobicy: "Jobicy",
  weworkremotely: "We Work Remotely",
  remotefirstjobs: "Remote First Jobs",
};

/** Hiring systems we can scan (every one we recognise). Anything else is kept as "not supported yet". */
export const SUPPORTED = new Set(Object.keys(ATS_LABEL));

/** What the watchlist needs to know about a company, from any source (suggestion, directory, link). */
export type CompanyRef = { name: string; ats: string; slug: string; region?: string; shard?: string; site?: string; careers_url: string };

/** Directory entry served at data/catalog/directory.json (see scripts/catalog/publish.ts). */
export type DirCompany = CompanyRef & {
  key: string;
  tier: "curated" | "dump";
  /** unverified: a seed company on a hiring system RawJobs can't check yet. */
  status: "live" | "dormant" | "unverified";
  open_jobs: number | null;
  indexed: boolean;
  tags?: string[];
  title_tags?: string[];
  /** Where each tag that no hand-made list gives came from (directories from October 2026 on). */
  tag_src?: Record<string, "wikidata" | "titles">;
  /** Found by you with "Add by link", or from the industry seed list. */
  origin?: "user" | "seed";
};

/** A directory entry as far as grouping needs it. */
type Board = { key: string; name: string; ats: string; status: string; open_jobs: number | null };

/** One company in search results: its best board first, then its other live boards. */
export type BoardGroup<T extends Board> = { lead: T; others: T[] };

/** "Gusto, Inc." and "gusto" are one company; "Binance.US" is not "Binance". */
const companyName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[,.]?\s+(inc|llc|ltd|limited|gmbh|corp|corporation|co)\.?$/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const boardRank = (b: Board) => [b.status === "live" ? 2 : b.status === "dormant" ? 1 : 0, SUPPORTED.has(b.ats) ? 1 : 0, b.open_jobs ?? 0];
const better = (a: Board, b: Board) => {
  const [x, y] = [boardRank(a), boardRank(b)];
  return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!;
};

/**
 * Many companies have boards on several hiring systems (Binance on Lever, Greenhouse, Ashby and
 * SmartRecruiters), often old ones left behind. Group boards by company name, keep the input order of
 * each group's first board, lead with the best (live, scannable, most jobs) and drop dead boards when a
 * live one exists. Boards in `keep` (ones you watch) are never dropped.
 */
export function groupBoards<T extends Board>(boards: readonly T[], keep: ReadonlySet<string> = new Set()): BoardGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const b of boards) {
    const k = companyName(b.name) || b.key;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  return [...groups.values()].map((list) => {
    const live = list.some((b) => b.status === "live");
    const [lead, ...others] = list.filter((b) => !live || b.status === "live" || keep.has(b.key)).sort(better);
    return { lead: lead!, others };
  });
}

/**
 * How many companies the directory holds: real employers (no sandbox or test boards), one per company
 * however many careers pages it has. The one "directory size" shown anywhere (H9), via roughCount().
 */
export function countCompanies(boards: readonly Board[]): number {
  const names = new Set<string>();
  for (const b of boards) if (!isPlaceholderBoard(b.name)) names.add(companyName(b.name) || b.key);
  return names.size;
}

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
