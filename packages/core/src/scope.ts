import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { companyKey, connectors } from "./connectors";
import { companyWords } from "./employers";
import { laneOf, laneWorkers } from "./run";
import { readJsonOnce } from "./json-once";
import { isPlaceholderBoard } from "./text";
import type { ScanScope } from "./protocol";
import type { BoardMove, CompanyHealth, CompanyRef, Config } from "./schema";
import type { DirectoryCompany } from "./suggest";

/**
 * What a scan fetches, besides your own companies (always all of them):
 *   mine:  Scan now: companies that matched you before and ones the shared job feed flags (stages.ts)
 *   yours: nothing more
 *   all:   every company in the directory we can read
 * Your industries only rank jobs higher, they never decide what's fetched. The directory is only the
 * list of companies and their boards; the jobs are always fetched live.
 */
export type { ScanScope } from "./protocol";
export const SCAN_SCOPES: readonly ScanScope[] = ["mine", "yours", "all"];

export type DirectoryEntry = DirectoryCompany & { indexed?: boolean; status?: string; origin?: "user" };

/** A move the shared directory accepted after its checks: old board key → new board key ("ats:slug|shard|site"). */
export type DirectoryMove = { from: string; to: string; name: string; accepted_at: string };

/** Board key as the directory's `moves` list writes it (lowercase; shard and site may be empty). */
export const boardKey = (c: { ats: string; slug: string; shard?: string; site?: string }) => `${c.ats}:${c.slug}|${c.shard ?? ""}|${c.site ?? ""}`.toLowerCase();

/** The shared directory's accepted moves (empty for a directory from before moves, or none downloaded). */
export function readDirectoryMoves(dataDir: string): DirectoryMove[] {
  const moves = readJsonOnce<{ moves?: unknown }>(join(dataDir, "catalog", "directory.json"))?.moves;
  return Array.isArray(moves) ? moves.filter((m): m is DirectoryMove => !!m && typeof m.from === "string" && typeof m.to === "string" && typeof m.accepted_at === "string") : [];
}

/** The local directory copy plus companies added by link (empty when not downloaded yet). */
export function readDirectory(dataDir: string): DirectoryEntry[] {
  const read = (name: string): DirectoryEntry[] => readJsonOnce<{ companies: DirectoryEntry[] }>(join(dataDir, "catalog", name))?.companies ?? [];
  const dir = read("directory.json");
  const known = new Set(dir.map((c) => c.key));
  return [
    ...dir,
    ...read("additions.json")
      .filter((c) => !known.has(c.key))
      .map((c) => ({ ...c, origin: "user" as const })),
  ];
}

/**
 * How many companies a suggestion request checks: every company in the job index plus the directory
 * companies without job rows (the `scanned` in `rawjobs companies suggest --json`). Cheap: the index's
 * count is read from the head of the file instead of parsing its 40 MB. Null when there's no index,
 * or its head doesn't say.
 */
export function suggestPoolSize(dataDir: string): number | null {
  const file = join(dataDir, "catalog", "index.json");
  if (!existsSync(file)) return null;
  const head = Buffer.alloc(512);
  const fd = openSync(file, "r");
  let read = 0;
  try {
    read = readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  const indexed = head.toString("utf8", 0, read).match(/"count":\s*(\d+)/)?.[1];
  if (indexed === undefined) return null;
  return Number(indexed) + readDirectory(dataDir).filter((c) => !c.indexed).length;
}

const nameKey = (name: string) => companyWords(name).join(" ");
const readable = (c: { ats: string }) => !!connectors[c.ats as CompanyRef["ats"]];

/** A directory board as a company to fetch. */
export function refOfEntry(c: DirectoryEntry): CompanyRef {
  return {
    name: c.name,
    ats: c.ats as CompanyRef["ats"],
    slug: c.slug,
    ...(c.region ? { region: c.region as CompanyRef["region"] } : {}),
    ...(c.shard ? { shard: c.shard } : {}),
    ...(c.site ? { site: c.site } : {}),
    ...(c.careers_url ? { careers_url: c.careers_url } : {}),
    enabled: true,
  };
}

/**
 * The directory companies a scan fetches beyond yours: live boards on hiring systems we can read,
 * not muted, not one of yours (by board or by name), not a sandbox/test board, one board per company
 * (the one with most jobs). Your own companies are always scanned, placeholder or not.
 */
export function scopeCompanies(config: Config, directory: readonly DirectoryEntry[], scope: ScanScope): CompanyRef[] {
  const yours = new Set(config.companies.map(companyKey));
  const yourNames = new Set(config.companies.map((c) => nameKey(c.name)));
  const muted = new Set(config.companies_muted);
  if (scope === "yours") return [];
  const best = new Map<string, DirectoryEntry>();
  for (const c of directory) {
    if (c.status !== "live" || !readable(c) || muted.has(c.key) || yours.has(c.key)) continue;
    if (c.origin !== "user" && isPlaceholderBoard(c.name)) continue;
    const name = nameKey(c.name) || c.key;
    if (yourNames.has(name)) continue;
    const prev = best.get(name);
    if (!prev || (c.open_jobs ?? 0) > (prev.open_jobs ?? 0)) best.set(name, c);
  }
  return [...best.values()].sort((a, b) => (b.open_jobs ?? 0) - (a.open_jobs ?? 0)).map(refOfEntry);
}

/**
 * The order to fetch directory companies in: likeliest to have a match for you first, so a slow or
 * stopped scan has already found most of what it will. Companies that matched before, then ones in
 * your industries, then those on hiring systems whose companies matched most often (the share of
 * them that did); the given order (most open jobs first) breaks ties. Lanes keep this order.
 */
export function byMatchChance<T extends CompanyRef>(companies: readonly T[], hints: { matchedBefore: (c: T) => boolean; inIndustry: (c: T) => boolean }): T[] {
  const seen = new Map<string, number>();
  const hits = new Map<string, number>();
  const matched = companies.map((c) => {
    const m = hints.matchedBefore(c);
    seen.set(c.ats, (seen.get(c.ats) ?? 0) + 1);
    if (m) hits.set(c.ats, (hits.get(c.ats) ?? 0) + 1);
    return m;
  });
  const chance = companies.map((c, i) => (matched[i] ? 4 : 0) + (hints.inIndustry(c) ? 2 : 0) + (hits.get(c.ats) ?? 0) / seen.get(c.ats)!);
  return companies
    .map((_, i) => i)
    .sort((a, b) => chance[b]! - chance[a]! || a - b)
    .map((i) => companies[i]!);
}

/**
 * Before a scan has measured a hiring system, its time comes from requests.
 Systems that serve every
 * company from one API host queue for that host: a request every 0.25 s (Greenhouse, Ashby) or 1 s.
 * The rest give each company its own host (Workday tenants, BambooHR…), so a lane's workers run side by side.
 */
const SHARED_HOST_SECONDS: Record<string, number> = {
  greenhouse: 0.25,
  ashby: 0.25,
  lever: 1,
  smartrecruiters: 1,
  workable: 1,
  comeet: 1,
  rippling: 1,
  paylocity: 1,
  paycom: 1,
  dayforce: 1,
};
/** Requests per company: pages, sessions, and for Workday a few detail pages. One for the rest. */
const REQUESTS: Record<string, number> = { workday: 3, smartrecruiters: 2, paycom: 2, oracle: 2, successfactors: 2, icims: 2, taleo: 3, cornerstone: 2, dayforce: 2 };
/** One request on a company's own host: the 1 s spacing between requests to a host, plus some answer time. */
const OWN_HOST_SECONDS = 1.2;
/** The shared job feed's part of a scan before one is measured: syncing it, then matching it against you. */
const FEED_SECONDS = 25;
/**
 * scan-speed.json's model: 2 dropped means that slow, failing boards blew up; 3 drops speeds that
 * counted 4 companies in flight on lanes that run 6 or 8, or that were learned from stopped scans.
 */
const SPEED_MODEL = 3;
/** Fewer companies than this from a hiring system in one scan say too little about its speed. */
const MIN_SAMPLES = 5;

/** Measured seconds per company per lane, by hiring system (data/scan-speed.json, updated after each scan). */
export type ScanSpeeds = Record<string, number>;

export function readSpeeds(dataDir: string): ScanSpeeds {
  try {
    const file = join(dataDir, "scan-speed.json");
    const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ScanSpeeds) : {};
    if (saved._model !== SPEED_MODEL) return {};
    const { _model, ...speeds } = saved;
    return speeds;
  } catch {
    return {};
  }
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Learn from a finished scan (not a stopped one: its last fetches were cut short or left waiting):
 * with laneWorkers companies in flight, a lane spends a company's duration over the companies in flight
 * on it. The median duration, so a few boards that time out don't make every scan look hours long. Averaged with what was known, so one slow day doesn't swing it.
 */
export function recordSpeeds(dataDir: string, health: readonly CompanyHealth[]): ScanSpeeds {
  const speeds = readSpeeds(dataDir);
  const byAts = new Map<string, number[]>();
  for (const h of health) if (!h.unsupported) byAts.set(h.ats, [...(byAts.get(h.ats) ?? []), h.durationMs]);
  for (const [ats, ms] of byAts) {
    if (ms.length < MIN_SAMPLES) continue;
    const measured = median(ms) / 1000 / Math.min(laneWorkers(ats), ms.length);
    speeds[ats] = Math.round((speeds[ats] === undefined ? measured : (speeds[ats] + measured) / 2) * 1000) / 1000;
  }
  writeFileSync(join(dataDir, "scan-speed.json"), JSON.stringify({ _model: SPEED_MODEL, ...speeds }, null, 1));
  return speeds;
}

/** A lane's seconds per company for this hiring system: measured, or from its requests. */
export function companySeconds(ats: string, speeds: ScanSpeeds = {}): number {
  const measured = speeds[ats];
  if (measured !== undefined) return measured;
  const requests = REQUESTS[ats] ?? 1;
  const shared = SHARED_HOST_SECONDS[ats];
  return shared !== undefined ? requests * shared : (requests * OWN_HOST_SECONDS) / laneWorkers(ats);
}

/**
 * About how long fetching these companies live takes: one lane per hiring system (and Workday shard,
 * as run.ts runs them), all lanes at once, so the slowest lane.
 */
export function estimateSeconds(companies: readonly Pick<CompanyRef, "ats" | "region" | "shard">[], speeds: ScanSpeeds = {}): number {
  const lanes = new Map<string, number>();
  for (const c of companies) {
    const lane = laneOf(c);
    lanes.set(lane, (lanes.get(lane) ?? 0) + companySeconds(c.ats, speeds));
  }
  return Math.ceil(Math.max(0, ...lanes.values()));
}

/** A scan's time in its two stages: the shared job feed (sync and match; 0 without it), then the live fetches. */
export type ScanEstimate = { feed: number; live: number; seconds: number };

export function estimateScan(companies: readonly Pick<CompanyRef, "ats" | "region" | "shard">[], o: { speeds?: ScanSpeeds; feed?: boolean; feedSeconds?: number } = {}): ScanEstimate {
  const feed = o.feed ? Math.ceil(o.feedSeconds ?? FEED_SECONDS) : 0;
  const live = estimateSeconds(companies, o.speeds);
  return { feed, live, seconds: feed + live };
}

/**
 * Your companies whose board is gone (404 this scan) but which the directory knows on another live
 * board we can read: the company may have moved hiring system or renamed its board. Only a suggestion:
 * the same name proves nothing (anyone can open a board called "Acme"), so the user checks it and chooses.
 */
export function findMoves(config: Config, directory: readonly DirectoryEntry[], health: readonly CompanyHealth[], accepted: readonly DirectoryMove[] = []): BoardMove[] {
  const failed = (ok: (h: CompanyHealth) => boolean) => new Set(health.filter((h) => !h.ok && ok(h)).map((h) => `${h.ats}:${h.slug}`.toLowerCase()));
  const gone = failed((h) => /\(404\)/.test(h.error ?? ""));
  const failing = failed(() => true);
  // Boards you have, and old ones you replaced with a new link: never suggested as where a company moved.
  const yours = new Set([...config.companies.map(companyKey), ...(config.companies_replaced ?? [])]);
  const byBoard = new Map(directory.map((d) => [boardKey(d), d]));
  const acceptedFrom = new Map(accepted.map((m) => [m.from.toLowerCase(), m]));
  const moves: BoardMove[] = [];
  for (const c of config.companies) {
    // A move RawJobs checked and accepted for everyone: offered whenever your board fails.
    const known = acceptedFrom.get(boardKey(c));
    const target = known && byBoard.get(known.to.toLowerCase());
    if (known && target && failing.has(`${c.ats}:${c.slug}`.toLowerCase()) && !yours.has(target.key) && readable(target)) {
      moves.push({ name: c.name, from: c, to: { ...refOfEntry(target), name: c.name }, checked_at: known.accepted_at });
      continue;
    }
    if (!gone.has(`${c.ats}:${c.slug}`.toLowerCase())) continue;
    const name = nameKey(c.name);
    const to = directory.filter((d) => nameKey(d.name) === name && d.status === "live" && readable(d) && !yours.has(d.key)).sort((a, b) => (b.open_jobs ?? 0) - (a.open_jobs ?? 0))[0];
    if (to) moves.push({ name: c.name, from: c, to: { ...refOfEntry(to), name: c.name } });
  }
  return moves;
}
