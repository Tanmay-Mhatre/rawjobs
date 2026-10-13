import { careersUrl, companyKey } from "@rawjobs/core/detect";
import { isPlaceholderBoard } from "@rawjobs/core/text";
import { rowId, type CompanyRow, type Draft } from "./setup";

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
  // Job boards: credited by name (Remote OK's terms ask for it), linked back on every job.
  hackernews: "Hacker News",
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  remoteok: "Remote OK",
};

/** Hiring systems we can scan (every one we recognise). Anything else is kept as "not supported yet". */
export const SUPPORTED = new Set(Object.keys(ATS_LABEL));

/** "Review failing companies" links: My companies, sorted by Needs attention. */
export const FAILING_HASH = "companies?sort=attention";
/** The address asks for Needs attention (a "failing" link was followed). */
export const wantsAttention = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("sort") === "attention";

/** Directory key for a watched company or a directory entry: "ats:slug" (Workday adds shard and site). */
export const keyOf = (c: { ats?: string; slug?: string; shard?: string; site?: string }) => companyKey({ ats: c.ats ?? "", slug: c.slug ?? "", shard: c.shard, site: c.site });

/** A job's directory key: saved jobs carry it; older ones fall back to the "ats:slug:" start of their id. */
export const jobCompanyKey = (j: { id: string; companyKey?: string }) => j.companyKey ?? j.id.split(":").slice(0, 2).join(":").toLowerCase();

/** What the watchlist needs to know about a company, from any source (suggestion, directory, link). */
export type CompanyRef = { name: string; ats: string; slug: string; region?: string; shard?: string; site?: string; careers_url: string };

/**
 * The company behind a job, to add or mute it from the Radar. A directory job links to the careers
 * page already; a scanned one gets the board's address. Workday keys are "tenant|shard|site", Taleo "host|section".
 */
export function refOfJob(j: { id: string; ats: string; company: string; url: string; companyKey?: string; estimated?: boolean }): CompanyRef {
  const key = jobCompanyKey(j);
  const parts = key.slice(key.indexOf(":") + 1).split("|");
  const slug = parts[0] ?? "";
  const board: { shard?: string; site?: string } = j.ats === "workday" && parts.length === 3 ? { shard: parts[1], site: parts[2] } : j.ats === "taleo" && parts.length === 2 ? { site: parts[1] } : {};
  return { name: j.company, ats: j.ats, slug, ...board, careers_url: j.estimated ? j.url : careersUrl({ ats: j.ats as never, slug, ...board }) || j.url };
}

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

export function toRow(c: CompanyRef): CompanyRow {
  return {
    id: rowId(),
    input: c.careers_url,
    state: SUPPORTED.has(c.ats) ? "saved" : "soon",
    name: c.name,
    ats: c.ats as CompanyRow["ats"],
    slug: c.slug,
    region: c.region as CompanyRow["region"],
    shard: c.shard,
    site: c.site,
  };
}

/** Add companies not in the draft yet (adding one also unhides it): the draft patch, and the keys actually added. */
export function addCompanies(draft: Pick<Draft, "companies" | "muted">, list: readonly CompanyRef[]): { patch: Partial<Draft> | null; keys: string[] } {
  const seen = new Set(draft.companies.map(keyOf));
  const rows = list.filter((c) => {
    const k = keyOf(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!rows.length) return { patch: null, keys: [] };
  const keys = new Set(rows.map(keyOf));
  return { patch: { companies: [...draft.companies, ...rows.map(toRow)], muted: draft.muted.filter((k) => !keys.has(k)) }, keys: [...keys] };
}

/**
 * Put a company's new board in place of its old one: same place in the list, same name, and the new
 * board unhidden. Null when the old one isn't in the list or the new board already is.
 */
export function replaceCompany(
  draft: Pick<Draft, "companies" | "muted">,
  oldKey: string,
  to: Omit<CompanyRef, "careers_url"> & { careers_url?: string },
): { patch: Partial<Draft>; before: CompanyRow; key: string } | null {
  const before = draft.companies.find((r) => keyOf(r) === oldKey);
  const key = keyOf(to);
  if (!before || draft.companies.some((r) => keyOf(r) === key)) return null;
  const row = { ...toRow({ ...to, name: before.name || to.name, careers_url: to.careers_url || careersUrl(to as never) }), id: before.id };
  return { patch: { companies: draft.companies.map((r) => (r === before ? row : r)), muted: draft.muted.filter((k) => k !== key) }, before, key };
}
