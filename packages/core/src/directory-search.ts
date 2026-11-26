import { companyIndex, companyMatches, type CompanyIndex } from "./company-search";
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
