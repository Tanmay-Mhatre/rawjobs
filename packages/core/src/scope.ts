import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { companyIndustries } from "./catalog/industries";
import { companyKey, connectors } from "./connectors";
import { companyWords } from "./employers";
import { isPlaceholderBoard } from "./text";
import type { ScanScope } from "./protocol";
import type { BoardMove, CompanyHealth, CompanyRef, Config } from "./schema";
import type { DirectoryCompany } from "./suggest";

/**
 * What a scan fetches, besides your own companies (always all of them):
 *   mine: directory companies in your industries (from lists or from their job titles)
 *   all:  every company in the directory we can read
 * The directory is only the list of companies and their boards; the jobs are always fetched live.
 */
export type { ScanScope } from "./protocol";
export const SCAN_SCOPES: readonly ScanScope[] = ["mine", "all"];

export type DirectoryEntry = DirectoryCompany & { indexed?: boolean; status?: string; origin?: "user" };

/** The local directory copy plus companies added by link (empty when not downloaded yet). */
export function readDirectory(dataDir: string): DirectoryEntry[] {
  const read = (name: string): DirectoryEntry[] => {
    const file = join(dataDir, "catalog", name);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { companies: DirectoryEntry[] }).companies : [];
  };
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
  const wanted = new Set(config.profile.industries);
  const best = new Map<string, DirectoryEntry>();
  for (const c of directory) {
    if (c.status !== "live" || !readable(c) || muted.has(c.key) || yours.has(c.key)) continue;
    if (scope === "mine" && !companyIndustries(c).some((t) => wanted.has(t))) continue;
    if (c.origin !== "user" && isPlaceholderBoard(c.name)) continue;
    const name = nameKey(c.name) || c.key;
    if (yourNames.has(name)) continue;
    const prev = best.get(name);
    if (!prev || (c.open_jobs ?? 0) > (prev.open_jobs ?? 0)) best.set(name, c);
  }
  return [...best.values()].sort((a, b) => (b.open_jobs ?? 0) - (a.open_jobs ?? 0)).map(refOfEntry);
}

/**
 * Seconds a lane spends per company, by hiring system, before a scan has measured it: the shared
 * APIs of Greenhouse and Ashby take 4 requests a second, the rest 1, and Workday pages.
 */
const DEFAULT_SECONDS: Record<string, number> = { greenhouse: 0.35, ashby: 0.35, workday: 1.5 };
const FALLBACK_SECONDS = 1.1;
/** Companies in flight per lane (run.ts LANE_WORKERS). */
const LANE_WORKERS = 4;

/** Measured seconds per company per lane, by hiring system (data/scan-speed.json, updated after each scan). */
export type ScanSpeeds = Record<string, number>;

export function readSpeeds(dataDir: string): ScanSpeeds {
  try {
    const file = join(dataDir, "scan-speed.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ScanSpeeds) : {};
  } catch {
    return {};
  }
}

/**
 * Learn from a scan: a lane's time is its companies' summed durations over the companies in flight, so
 * per company that's sum / (in flight × count). Averaged with what was known, so one slow day doesn't swing it.
 */
export function recordSpeeds(dataDir: string, health: readonly CompanyHealth[]): ScanSpeeds {
  const speeds = readSpeeds(dataDir);
  const byAts = new Map<string, number[]>();
  for (const h of health) if (!h.unsupported) byAts.set(h.ats, [...(byAts.get(h.ats) ?? []), h.durationMs]);
  for (const [ats, ms] of byAts) {
    if (ms.length < 3) continue;
    const measured = ms.reduce((a, b) => a + b, 0) / 1000 / (Math.min(LANE_WORKERS, ms.length) * ms.length);
    speeds[ats] = Math.round((speeds[ats] === undefined ? measured : (speeds[ats] + measured) / 2) * 1000) / 1000;
  }
  writeFileSync(join(dataDir, "scan-speed.json"), JSON.stringify(speeds, null, 1));
  return speeds;
}

/** About how long a scan of these companies takes: hiring systems run in parallel, so the slowest lane. */
export function estimateSeconds(companies: readonly Pick<CompanyRef, "ats" | "region">[], speeds: ScanSpeeds = {}): number {
  const lanes = new Map<string, number>();
  for (const c of companies) {
    const lane = `${c.ats}:${c.region ?? ""}`;
    lanes.set(lane, (lanes.get(lane) ?? 0) + (speeds[c.ats] ?? DEFAULT_SECONDS[c.ats] ?? FALLBACK_SECONDS));
  }
  return Math.ceil(Math.max(0, ...lanes.values()));
}

/**
 * Your companies whose board is gone (404 this scan) but which the directory knows on another live
 * board we can read: the company may have moved hiring system or renamed its board. Only a suggestion:
 * the same name proves nothing (anyone can open a board called "Acme"), so the user checks it and chooses.
 */
export function findMoves(config: Config, directory: readonly DirectoryEntry[], health: readonly CompanyHealth[]): BoardMove[] {
  const gone = new Set(health.filter((h) => !h.ok && /\(404\)/.test(h.error ?? "")).map((h) => `${h.ats}:${h.slug}`.toLowerCase()));
  const yours = new Set(config.companies.map(companyKey));
  const moves: BoardMove[] = [];
  for (const c of config.companies) {
    if (!gone.has(`${c.ats}:${c.slug}`.toLowerCase())) continue;
    const name = nameKey(c.name);
    const to = directory.filter((d) => nameKey(d.name) === name && d.status === "live" && readable(d) && !yours.has(d.key)).sort((a, b) => (b.open_jobs ?? 0) - (a.open_jobs ?? 0))[0];
    if (to) moves.push({ name: c.name, from: c, to: { ...refOfEntry(to), name: c.name } });
  }
  return moves;
}
