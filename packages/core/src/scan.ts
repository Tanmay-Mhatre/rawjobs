import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isChronic, knownFirstPages, planBoards, pruneBoards, readBoardHealth, recordBoards, writeBoardHealth } from "./board-health";
import { companyIndustries } from "./catalog/industries";
import { companyKey, companyOfJobId, jobCompanyKey } from "./connectors";
import { mergeHistory, type MergeResult } from "./diff";
import { keptChecked, readLedger, recordChecks, writeLedger } from "./discover";
import { HttpClient, type HttpStats } from "./http";
import { FileHttpCache } from "./http-cache";
import { readLocationCache, writeLocationCache } from "./location-cache";
import { FEED_MAX_AGE_DAYS, feedMatches, jobFeedStatus } from "./job-feed";
import { checkStillOpen, jobsToRecheck } from "./liveness";
import { loadConcepts } from "./concepts-remote";
import { alertJobs } from "./notify";
import { runRadar, type RunResult } from "./run";
import type { BoardMove, CompanyHealth, CompanyRef, Config, Job, RunSummary } from "./schema";
import { byMatchChance, estimateScan, findMoves, readDirectory, readDirectoryMoves, readSpeeds, recordSpeeds, refOfEntry, scopeCompanies, type ScanEstimate, type ScanScope } from "./scope";
import { fetchedSince, quickPicks } from "./stages";
import { readJobs, saveRun } from "./store";
import type { ScanSource } from "./protocol";

export type ScanStart = {
  /** Your companies' names, in fetch order. */
  yours: string[];
  /** Directory companies fetched beyond yours. */
  extra: number;
  /** Everything this scan covers, including companies done before a resume. */
  total: number;
  /** Companies already done by the stopped scan this one resumes. */
  resumed: number;
  /** Directory companies skipped because the shared job feed shows nothing for you there. */
  skippedByFeed?: number;
  /** Boards left alone this scan: their last fetch failed and their rest isn't over (board-health.ts). */
  resting?: number;
  /** Directory boards left alone this scan: their jobs haven't changed for weeks and they were fetched recently. */
  quiet?: number;
  scope?: ScanScope;
  /** Scan now: where each directory company comes from ("past" match or "feed" pick), by jobCompanyKey(). */
  sources?: Record<string, ScanSource>;
  /** How old the shared job feed is, in days (undefined without one). */
  feedAgeDays?: number;
  /** Scan now with no feed fresh enough to pick companies: every company is checked instead. */
  fallback?: boolean;
  /** About how long the rest takes. */
  seconds: number;
  /** The scan's time by stage: the shared job feed (sync and match, done by now: as measured) and the live fetches (as `seconds`). */
  stages?: ScanEstimate;
  /** Companies this scan covers per hiring system ("greenhouse": 120), including ones done before a resume. */
  byAts: Record<string, number>;
  /** Of those, done by the stopped scan this one resumes, per hiring system. */
  resumedByAts: Record<string, number>;
};

export type ScanOptions = {
  dataDir: string;
  /** Your companies plus: "mine" = past matches and the feed's picks (Scan now), "yours" = nothing more, "all" = the whole directory. Default mine. */
  scope?: ScanScope;
  /** Leave directory boards fetched at or after this time (ms): the background check skips what Scan now just did. */
  skipFetchedSince?: number;
  /** Only these companies (name or slug); nothing from the directory. */
  only?: string[];
  /** Check just these directory companies ("ats:slug" keys), nothing else ("Check now" on the Radar). */
  checkKeys?: string[];
  /** Run and report, save nothing. */
  dryRun?: boolean;
  /** Carry on a stopped scan of the same scope from the last 24 hours (default true). */
  resume?: boolean;
  /**
   * Use the shared job feed to skip directory companies with nothing for you (default true). Your own
   * companies, and companies the feed doesn't cover, are always fetched live.
   */
  feed?: boolean;
  /** Stop starting new companies when this returns true; what's done is saved and can be resumed. */
  stopped?: () => boolean;
  /**
   * An alert follows this scan: before saving, check the doubtful jobs it would name are still open
   * (liveness.ts). Closed ones are saved as closed and left out of the result, so the alert skips them.
   */
  checkBeforeAlert?: boolean;
  http?: HttpClient;
  now?: Date;
  onStart?: (info: ScanStart) => void;
  onCompanyDone?: (h: CompanyHealth) => void;
  /** Each company's health and the jobs kept from it (matches and history), as soon as it's done. */
  onCompanyResult?: (h: CompanyHealth, jobs: Job[]) => void;
  /** How long syncing the directory and job feed took before this scan, for its timings. */
  syncMs?: number;
};

/** Where a scan's time went, and what its requests did (data/scan-stats.json keeps the last few). */
export type ScanStats = {
  startedAt: string;
  scope?: ScanScope;
  /** Milliseconds per stage: syncing (before the scan), matching the job feed, live fetches, saving. */
  stages: { sync: number; match: number; live: number; save: number };
  wallMs: number;
  http: HttpStats;
  /** Every company fetched this run: milliseconds, by jobCompanyKey(). Kept for the latest run only. */
  companies?: Record<string, number>;
  /** Directory boards left alone by their record (board-health.ts): resting after failures, or quiet. */
  skippedByHealth?: number;
  /** Paged boards whose first page was as last time: only that page was read. */
  unchanged?: number;
  /** The shared job feed's age when the scan started, in hours. */
  feedAgeHours?: number;
};
const KEEP_STATS = 20;

export function readScanStats(dataDir: string): ScanStats[] {
  try {
    const file = join(dataDir, "scan-stats.json");
    return existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { runs?: ScanStats[] }).runs ?? []) : [];
  } catch {
    return [];
  }
}

function writeScanStats(dataDir: string, stats: ScanStats): void {
  const runs = [stats, ...readScanStats(dataDir).map(({ companies: _, ...r }) => r)].slice(0, KEEP_STATS);
  writeFileSync(join(dataDir, "scan-stats.json"), JSON.stringify({ version: 1, runs }));
}

/** Past this many hours, the job feed's "nothing for you" is checked live for the likeliest companies (liveDespiteFeed). */
export const FEED_RECHECK_HOURS = 12;

/**
 * Whether a directory company the shared job feed shows nothing for you at is fetched live anyway, by
 * the feed's age: once it's over FEED_RECHECK_HOURS old, companies that matched before and ones in
 * your industries are; once it's over FEED_MAX_AGE_DAYS, every one is (the feed no longer counts).
 */
export function liveDespiteFeed(feedAgeHours: number, c: { matchedBefore: boolean; inIndustry: boolean }): boolean {
  if (feedAgeHours > FEED_MAX_AGE_DAYS * 24) return true;
  return feedAgeHours > FEED_RECHECK_HOURS && (c.matchedBefore || c.inIndustry);
}

/** Companies (jobCompanyKey()) with a job that matched you in history. */
function pastMatchers(jobs: readonly Job[]): Set<string> {
  const keys = new Set<string>();
  for (const j of jobs) if (!j.why?.gate) keys.add(companyOfJobId(j.id));
  return keys;
}

/** The directory companies the feed leaves to a live fetch: those it doesn't cover, has something for you at, or (by its age) liveDespiteFeed. */
function feedLeaves<T extends CompanyRef>(
  companies: readonly T[],
  feed: { covered: ReadonlySet<string>; matching: ReadonlySet<string> },
  ageHours: number,
  hints: { matchedBefore: (c: T) => boolean; inIndustry: (c: T) => boolean },
): T[] {
  return companies.filter((c) => {
    const key = jobCompanyKey(c);
    return !feed.covered.has(key) || feed.matching.has(key) || liveDespiteFeed(ageHours, { matchedBefore: hints.matchedBefore(c), inIndustry: hints.inIndustry(c) });
  });
}

/** How a scan tells which directory companies are likeliest to have something for you (byMatchChance, liveDespiteFeed). */
function matchHints(config: Config, previous: readonly Job[], industriesOf: (c: CompanyRef) => readonly string[] | undefined) {
  const matched = pastMatchers(previous);
  const wanted = new Set(config.profile.industries);
  return {
    matchedBefore: (c: CompanyRef) => matched.has(jobCompanyKey(c)),
    inIndustry: (c: CompanyRef) => !!industriesOf(c)?.some((t) => wanted.has(t)),
  };
}

/** The job feed's part of the last scans that used it (sync + match), for the next estimate. */
function feedSecondsFrom(dataDir: string): number | undefined {
  const last = readScanStats(dataDir).find((r) => r.stages.sync + r.stages.match > 0);
  return last ? (last.stages.sync + last.stages.match) / 1000 : undefined;
}

export type ScanResult = {
  result: RunResult;
  merged: MergeResult;
  summary?: RunSummary;
  /** Directory companies fetched beyond yours. */
  checks: CompanyRef[];
  /** Your companies whose board is gone, and where the directory may have it now: suggestions to review, never applied. */
  moves: BoardMove[];
  /** Stopped before the end: resumable. */
  stopped: boolean;
  /** With checkBeforeAlert: jobs checked again before the alert, and how many of them had closed. */
  openCheck?: { checked: number; closed: number };
  /** Boards this scan left alone because they're resting after failures. */
  resting: number;
  /** Directory boards this scan left alone because they're quiet (unchanged for weeks, fetched recently). */
  quiet: number;
  /** This scan's boards with no fetch that worked for 30 days or more, as "Name (ats:slug)". */
  chronic: string[];
  /** Where the time went (also saved to data/scan-stats.json, not for a dry run). */
  stats: ScanStats;
};

/** A scan in progress, saved as it goes so a stopped (or crashed) scan carries on where it was. */
type Progress = { version: 1 | 2; scope: ScanScope; startedAt: string; health: CompanyHealth[]; jobs: Job[] };
/**
 * One progress file per scan type, so a quick scan never overwrites a long one that was stopped.
 * One JSON line to start ({ version: 2, scope, startedAt }), then a line per batch of results
 * ({ health, jobs }) appended as they come: never the whole file again. Version 1 was one JSON object.
 */
const progressFile = (scope: ScanScope) => `scan-progress-${scope}.json`;
const RESUME_WITHIN_MS = 24 * 3_600_000;
const SAVE_EVERY_MS = 5_000;
/** The saved responses' index is written this often during a scan (and at the end). */
const CACHE_SAVE_EVERY_MS = 60_000;

export function readProgress(dataDir: string, scope: ScanScope): Progress | undefined {
  const path = join(dataDir, progressFile(scope));
  try {
    if (!existsSync(path)) return undefined;
    const text = readFileSync(path, "utf8");
    const [head, ...rest] = text.split("\n");
    const first = JSON.parse(head!) as Progress | { version: 2; scope: ScanScope; startedAt: string };
    if (first.version === 1) return first as Progress;
    const progress: Progress = { version: 2, scope: first.scope, startedAt: first.startedAt, health: [], jobs: [] };
    for (const line of rest) {
      if (!line.trim()) continue;
      let batch: { health: CompanyHealth[]; jobs: Job[] };
      try {
        batch = JSON.parse(line) as typeof batch;
      } catch {
        // A line cut short by a crash: the companies on it are fetched again.
        continue;
      }
      progress.health.push(...batch.health);
      progress.jobs.push(...batch.jobs);
    }
    return progress;
  } catch {
    return undefined;
  }
}

/** The stopped scan a new one would resume, if any. */
export function resumable(dataDir: string, scope: ScanScope, now = new Date()): { done: number; startedAt: string } | undefined {
  const p = readProgress(dataDir, scope);
  if (!p || p.scope !== scope || now.getTime() - Date.parse(p.startedAt) > RESUME_WITHIN_MS) return undefined;
  return { done: p.health.length, startedAt: p.startedAt };
}

/**
 * Your companies and, by scope, the directory companies a scan would fetch. "all" (Check every company
 * now, the background check) fetches every company live, without the job feed choosing.
 */
export function scanPlan(config: Config, dataDir: string, scope: ScanScope, directory = readDirectory(dataDir)) {
  const yours = config.companies.filter((c) => c.enabled);
  const feed = scope === "all" ? undefined : feedMatches(dataDir, config.profile);
  const tagged = new Map(directory.map((c) => [c.key, companyIndustries(c)] as const));
  const hints = matchHints(config, readJobs(dataDir), (c) => tagged.get(companyKey(c)));
  const candidates = scopeCompanies(config, directory, scope);
  const quick = scope === "mine" ? quickPicks(candidates, { feed, ledger: readLedger(dataDir), matchedBefore: hints.matchedBefore }) : undefined;
  const inScope = quick ? quick.picks : feed ? feedLeaves(candidates, feed, jobFeedStatus(dataDir).ageDays * 24, hints) : candidates;
  // Resting and quiet directory boards aren't fetched, so they don't count towards the time.
  const extra = planBoards(inScope, readBoardHealth(dataDir), Date.now(), { yours: new Set(yours.map(jobCompanyKey)) }).fetch;
  const estimate = estimateScan([...yours, ...extra], { speeds: readSpeeds(dataDir), feed: !!feed && feed.covered.size > 0, feedSeconds: feedSecondsFrom(dataDir) });
  return { yours, extra, seconds: estimate.seconds, stages: estimate, fallback: !!quick?.fallback };
}

/**
 * A scan: every one of your companies, plus directory companies by scope, all fetched live. The
 * directory is only the list of companies and boards (sync it first: syncDirectory). Saves history
 * and the dashboard files; the progress file lets a stopped scan resume.
 */
export async function scan(config: Config, opts: ScanOptions): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const clock = Date.now();
  const scope = opts.scope ?? "mine";
  // Your industries only rank jobs higher, and only while that's on: off, they don't count at all.
  const scoring = config.scans?.industry_boost === false ? { ...config, profile: { ...config.profile, industries: [] } } : config;
  const previous = readJobs(opts.dataDir);
  const tracked = new Set(config.companies.map(companyKey));
  const muted = new Set(config.companies_muted);
  const checkOnly = !!opts.checkKeys?.length;
  const fullScan = !checkOnly && !opts.only?.length;
  const directory = checkOnly || fullScan ? readDirectory(opts.dataDir) : [];
  // Each company's industries, for the industry part of the score (the store reads the same directory).
  const tagged = new Map((directory.length ? directory : readDirectory(opts.dataDir)).map((c) => [c.key, companyIndustries(c)] as const));
  const industriesOf = (c: CompanyRef) => tagged.get(companyKey(c));
  let ledger = readLedger(opts.dataDir);

  const wanted = new Set(opts.checkKeys?.map((k) => k.toLowerCase()));
  const inScope = checkOnly ? directory.filter((c) => wanted.has(c.key) && !tracked.has(c.key)).map(refOfEntry) : fullScan ? scopeCompanies(config, directory, scope) : [];
  // Yesterday's shared feed says which directory companies have jobs that could be yours: only those
  // (and ones it doesn't cover) are fetched live, so what's shown is still checked live.
  const matchStarted = Date.now();
  const feed = fullScan && opts.feed !== false ? feedMatches(opts.dataDir, config.profile, now.getTime()) : undefined;
  const matchMs = Date.now() - matchStarted;
  // An older feed leaves more to the live fetch: the likeliest companies past 12 h, all of them past 3 days.
  const hints = matchHints(config, previous, industriesOf);
  const feedAgeHours = feed ? jobFeedStatus(opts.dataDir, now.getTime()).ageDays * 24 : undefined;
  // Scan now: past matches and the feed's picks (every company when the feed is too old to pick).
  const quick = fullScan && scope === "mine" ? quickPicks(inScope, { feed, ledger, matchedBefore: hints.matchedBefore }) : undefined;
  const feedAge = fullScan ? jobFeedStatus(opts.dataDir, now.getTime()).ageDays : Infinity;
  let boards = readBoardHealth(opts.dataDir);
  const since = opts.skipFetchedSince;
  const unfed = (quick ? quick.picks : feed ? feedLeaves(inScope, feed, feedAgeHours!, hints) : inScope).filter((c) => since === undefined || !fetchedSince(boards.boards[jobCompanyKey(c)], since));
  // Carry on a stopped scan of the same scope: skip what it fetched, keep what it found.
  const progressPath = join(opts.dataDir, progressFile(scope));
  const prior = fullScan && opts.resume !== false && !opts.dryRun ? readProgress(opts.dataDir, scope) : undefined;
  const resumed = prior && prior.scope === scope && now.getTime() - Date.parse(prior.startedAt) <= RESUME_WITHIN_MS ? prior : undefined;
  const done = new Set((resumed?.health ?? []).map((h) => h.key ?? jobCompanyKey(h)));
  // Directory boards whose last fetch failed rest for a while, and ones whose jobs haven't changed
  // for weeks are fetched less often (board-health.ts). Your companies are always fetched; so is a
  // scan of chosen ones ("Check now", --only), and the stopped scan's count as done.
  const plan = { yours: new Set(config.companies.map(jobCompanyKey)), done };
  const directoryPlan = fullScan ? planBoards(unfed, boards, now.getTime(), plan) : { fetch: unfed, resting: [], quiet: [] };
  // Likeliest matches first, so what a slow or stopped scan finds is most of what it would.
  const checks = byMatchChance(directoryPlan.fetch, hints);
  // Saved responses: a board that hasn't changed since the last scan answers with an empty 304.
  const cache = opts.http || opts.dryRun ? undefined : new FileHttpCache(join(opts.dataDir, "cache", "http"));
  // The weekly word list that makes "PSP" count as payments (concepts-remote.ts); the built-in one when offline.
  if (!opts.http && !opts.dryRun) await loadConcepts(opts.dataDir);
  // A host that doesn't answer gives up after 8 s; one that answers gets 15 s for the body.
  // Each hiring system's API paced as a whole, faster while it keeps up (http.ts paceOf).
  const http = opts.http ?? new HttpClient({ cache, connectTimeoutMs: 8_000, readTimeoutMs: 15_000, retries: 2, breakAfter: 3, adaptive: true });
  // Where "3 Locations" jobs really are, from earlier scans: their pages aren't fetched again for that.
  const locations = readLocationCache(opts.dataDir);
  const knownLocations = locations.size;
  // The progress file: started again (with what a resumed scan had), then appended to.
  const saving = fullScan && !opts.dryRun;
  if (saving) {
    const head = JSON.stringify({ version: 2, scope, startedAt: resumed?.startedAt ?? now.toISOString() });
    writeFileSync(progressPath, `${head}\n${resumed?.health.length ? `${JSON.stringify({ health: resumed.health, jobs: resumed.jobs })}\n` : ""}`);
  }
  let pending: { health: CompanyHealth[]; jobs: Job[] } = { health: [], jobs: [] };
  let lastSave = 0;
  let lastCacheSave = Date.now();
  const saveProgress = (force = false) => {
    if (!saving || (!force && Date.now() - lastSave < SAVE_EVERY_MS)) return;
    lastSave = Date.now();
    if (pending.health.length) appendFileSync(progressPath, `${JSON.stringify(pending)}\n`);
    pending = { health: [], jobs: [] };
    if (force || Date.now() - lastCacheSave >= CACHE_SAVE_EVERY_MS) {
      lastCacheSave = Date.now();
      cache?.save();
    }
  };

  const only = opts.only?.map((s) => s.toLowerCase());
  const chosen = checkOnly
    ? []
    : config.companies.filter(
        (c) =>
          c.enabled && (!only?.length || only.includes(c.name.toLowerCase()) || only.includes(c.slug.toLowerCase())) && (since === undefined || !fetchedSince(boards.boards[jobCompanyKey(c)], since)),
      );
  const yours = chosen;
  const resting = directoryPlan.resting;
  const left = [...yours, ...checks].filter((c) => !done.has(jobCompanyKey(c)));
  const live = estimateScan(left, { speeds: readSpeeds(opts.dataDir) }).live;
  const feedSeconds = feed ? Math.round((matchMs + (opts.syncMs ?? 0)) / 1000) : 0;
  const byAts: Record<string, number> = {};
  const resumedByAts: Record<string, number> = {};
  for (const c of [...yours, ...checks]) {
    byAts[c.ats] = (byAts[c.ats] ?? 0) + 1;
    if (done.has(jobCompanyKey(c))) resumedByAts[c.ats] = (resumedByAts[c.ats] ?? 0) + 1;
  }
  opts.onStart?.({
    yours: yours.map((c) => c.name),
    extra: checks.length,
    total: yours.length + checks.length,
    resumed: done.size,
    ...(fullScan ? { scope } : {}),
    ...(quick && !quick.fallback ? { sources: Object.fromEntries(quick.sources) } : {}),
    ...(quick?.fallback ? { fallback: true } : {}),
    ...(Number.isFinite(feedAge) ? { feedAgeDays: feedAge } : {}),
    ...(feed && !quick ? { skippedByFeed: inScope.length - unfed.length } : {}),
    ...(resting.length ? { resting: resting.length } : {}),
    ...(directoryPlan.quiet.length ? { quiet: directoryPlan.quiet.length } : {}),
    seconds: live,
    stages: { feed: feedSeconds, live, seconds: feedSeconds + live },
    byAts,
    resumedByAts,
  });

  // "Check now" fetches only the asked-for companies; your own jobs are left as they are.
  const liveStarted = Date.now();
  // The background check leaves your companies Scan now just fetched.
  const run = await runRadar(checkOnly ? { ...scoring, companies: [] } : since !== undefined ? { ...scoring, companies: chosen } : scoring, {
    http,
    now,
    only: opts.only,
    previous,
    checks,
    skip: done,
    stopped: opts.stopped,
    industriesOf,
    locations,
    // Your companies' first pages too: theirs are only reused when every job is there (run.ts).
    firstPages: fullScan ? knownFirstPages(boards, now.getTime()) : undefined,
    onCompanyDone: opts.onCompanyDone,
    onCompanyResult: (h, jobs) => {
      pending.health.push(h);
      // Jobs that don't match you keep no description (as in history), so progress stays small.
      pending.jobs.push(...jobs.map((j) => (j.why.gate ? { ...j, description: undefined } : j)));
      saveProgress();
      opts.onCompanyResult?.(h, jobs);
    },
  });
  const liveMs = Date.now() - liveStarted;
  const saveStarted = Date.now();
  const stopped = !!opts.stopped?.();
  const result: RunResult = resumed ? { ...run, startedAt: resumed.startedAt, jobs: [...resumed.jobs, ...run.jobs], health: [...resumed.health, ...run.health] } : run;
  if (checkOnly) result.partial = true;
  // Every company checked: a whole-directory scan, or a Scan now that had to check them all, run to the end.
  if (fullScan && !stopped && (scope === "all" || quick?.fallback)) result.everyCompany = true;

  // Your companies whose board is gone, but which the directory lists on another board: a suggestion only.
  // Matching names proves nothing (anyone can open a board called "Acme"), so you check it and choose; nothing switches here.
  const moves = fullScan && !stopped ? findMoves(config, directory, result.health, readDirectoryMoves(opts.dataDir)) : [];

  // Directory companies keep their matching jobs between scans (ledger), unless you've added or muted them since.
  // Only ones with matches (or that had some) are recorded, so a scan of the whole directory stays small.
  // One lookup per company: an "all" scan checks ~17,000, and a find() per company was ~10^8 comparisons.
  const matchesBy = new Map(result.health.map((h) => [`${h.ats}:${h.slug}`, h.matches]));
  const recorded = checks.filter((c) => (matchesBy.get(`${c.ats}:${c.slug}`) ?? 0) > 0 || !!ledger.companies[companyKey(c)]);
  ledger = recordChecks(ledger, recorded, result.health, now);
  const kept = keptChecked(ledger, now).filter((c) => !tracked.has(companyKey(c)) && !muted.has(companyKey(c)));
  const merged = mergeHistory(previous, result, [...config.companies, ...kept]);
  cache?.save({ prune: !stopped });
  if (!opts.dryRun) writeLocationCache(opts.dataDir, locations, knownLocations);

  // This run's fetches only: a resumed scan's earlier ones were recorded when it stopped.
  boards = recordBoards(boards, run.health, now.getTime());
  if (fullScan) boards = pruneBoards(boards, new Set([...config.companies, ...inScope].map(jobCompanyKey)), now.getTime());
  const chronic = [...chosen, ...inScope].filter((c) => isChronic(boards.boards[jobCompanyKey(c)], now.getTime())).map((c) => `${c.name} (${c.ats}:${c.slug})`);
  const boardNews = { resting: resting.length, quiet: directoryPlan.quiet.length, chronic };
  const statsOf = (): ScanStats => ({
    startedAt: now.toISOString(),
    ...(fullScan ? { scope } : {}),
    stages: { sync: opts.syncMs ?? 0, match: matchMs, live: liveMs, save: Date.now() - saveStarted },
    wallMs: Date.now() - clock + (opts.syncMs ?? 0),
    http: { ...http.stats },
    companies: Object.fromEntries(run.health.map((h) => [h.key ?? jobCompanyKey(h), h.durationMs])),
    ...(fullScan ? { skippedByHealth: resting.length + directoryPlan.quiet.length } : {}),
    unchanged: run.health.filter((h) => h.unchanged).length,
    ...(feedAgeHours !== undefined && Number.isFinite(feedAgeHours) ? { feedAgeHours: Math.round(feedAgeHours * 10) / 10 } : {}),
  });

  if (opts.dryRun) return { result, merged, checks, moves, stopped, ...boardNews, stats: statsOf() };

  // Jobs the alert would name that weren't just read live: checked once more. A closed one is saved
  // closed (as mergeHistory closes them) and leaves this run's jobs, so it's neither alerted nor counted new.
  let openCheck: ScanResult["openCheck"];
  if (opts.checkBeforeAlert) {
    const doubtful = jobsToRecheck(alertJobs(config, result.jobs, merged.newIds), run.startedAt);
    const { checked, closed } = await checkStillOpen(doubtful, { http, now, stopped: opts.stopped });
    if (closed.size) {
      merged.jobs = merged.jobs.map((j) => (closed.has(j.id) ? { ...j, status: "closed", closedAt: now.toISOString() } : j));
      for (const id of closed) {
        merged.closedIds.add(id);
        merged.newIds.delete(id);
      }
      result.jobs = result.jobs.filter((j) => !closed.has(j.id));
    }
    openCheck = { checked, closed: closed.size };
  }

  // Run history keeps your companies and the directory ones that matched or failed, not every board.
  const yourKeys = new Set(config.companies.map(companyKey));
  const health = result.health.filter((h) => yourKeys.has(companyKey(h)) || h.matches > 0 || (!h.ok && !h.unsupported));
  const summary = saveRun(opts.dataDir, config, { ...result, health, checked: checks.length, ...(moves.length ? { moves } : {}) }, merged, { record: !checkOnly, boards });
  writeLedger(opts.dataDir, ledger);
  writeBoardHealth(opts.dataDir, boards);
  if (!checkOnly) recordSpeeds(opts.dataDir, run.health);
  // The Radar shows only jobs fetched live; the shared index is for suggestions on the Companies page.
  if (fullScan) writeFileSync(join(opts.dataDir, "discover.json"), JSON.stringify({ version: 1, generatedAt: result.finishedAt, indexGeneratedAt: result.finishedAt, jobs: [] }));
  if (stopped) saveProgress(true);
  else if (fullScan) rmSync(progressPath, { force: true });
  const stats = statsOf();
  writeScanStats(opts.dataDir, stats);
  return { result, merged, summary, checks, moves, stopped, ...boardNews, stats, ...(openCheck ? { openCheck } : {}) };
}

/**
 * One scan at a time per data folder (a scheduled scan and a dashboard scan could otherwise both
 * write history). The lock holds the scan's process id and is created with "wx", so of two scans
 * starting at the same moment only one gets it. A lock left by a process that's gone is taken over.
 */
export function acquireScanLock(dataDir: string): boolean {
  const path = join(dataDir, "scan.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const holder = lockHolder(path);
    if (holder === process.pid) return true;
    if (holder !== undefined && isRunning(holder)) return false;
    // Left by a process that's gone: remove it (unless another scan just took it over) and try again.
    if (lockHolder(path) === holder) rmSync(path, { force: true });
  }
  return false;
}

/** The process id in a lock file; undefined when it's gone or unreadable. */
function lockHolder(path: string): number | undefined {
  try {
    return Number(readFileSync(path, "utf8")) || undefined;
  } catch {
    return undefined;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it's just someone else's.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a scan holds the lock right now: a scheduled one, or one the dashboard started. */
export function scanLockHeld(dataDir: string): boolean {
  const holder = lockHolder(join(dataDir, "scan.lock"));
  return holder !== undefined && holder !== process.pid && isRunning(holder);
}

export function releaseScanLock(dataDir: string): void {
  const path = join(dataDir, "scan.lock");
  try {
    if (Number(readFileSync(path, "utf8")) === process.pid) rmSync(path, { force: true });
  } catch {
    // already gone
  }
}
