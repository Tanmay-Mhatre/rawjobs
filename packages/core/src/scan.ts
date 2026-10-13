import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { companyIndustries } from "./catalog/industries";
import { companyKey, jobCompanyKey } from "./connectors";
import { mergeHistory, type MergeResult } from "./diff";
import { keptChecked, readLedger, recordChecks, writeLedger } from "./discover";
import { HttpClient } from "./http";
import { FileHttpCache } from "./http-cache";
import { feedMatches } from "./job-feed";
import { runRadar, type RunResult } from "./run";
import type { BoardMove, CompanyHealth, CompanyRef, Config, Job, RunSummary } from "./schema";
import { estimateSeconds, findMoves, readDirectory, readSpeeds, recordSpeeds, refOfEntry, scopeCompanies, type ScanScope } from "./scope";
import { readJobs, saveRun } from "./store";

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
  scope?: ScanScope;
  /** About how long the rest takes. */
  seconds: number;
  /** Companies this scan covers per hiring system ("greenhouse": 120), including ones done before a resume. */
  byAts: Record<string, number>;
  /** Of those, done by the stopped scan this one resumes, per hiring system. */
  resumedByAts: Record<string, number>;
};

export type ScanOptions = {
  dataDir: string;
  /** Your companies plus: "mine" = directory companies in your industries, "all" = the whole directory. Default mine. */
  scope?: ScanScope;
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
  http?: HttpClient;
  now?: Date;
  onStart?: (info: ScanStart) => void;
  onCompanyDone?: (h: CompanyHealth) => void;
};

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
};

/** A scan in progress, saved as it goes so a stopped (or crashed) scan carries on where it was. */
type Progress = { version: 1; scope: ScanScope; startedAt: string; health: CompanyHealth[]; jobs: Job[] };
/** One progress file per scan type, so a quick scan never overwrites a long one that was stopped. */
const progressFile = (scope: ScanScope) => `scan-progress-${scope}.json`;
const RESUME_WITHIN_MS = 24 * 3_600_000;
const SAVE_EVERY_MS = 5_000;

export function readProgress(dataDir: string, scope: ScanScope): Progress | undefined {
  const path = join(dataDir, progressFile(scope));
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Progress) : undefined;
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

/** Your companies and, by scope, the directory companies a scan would fetch. */
export function scanPlan(config: Config, dataDir: string, scope: ScanScope) {
  const yours = config.companies.filter((c) => c.enabled);
  const feed = feedMatches(dataDir, config.profile);
  const extra = scopeCompanies(config, readDirectory(dataDir), scope).filter((c) => !feed.covered.has(jobCompanyKey(c)) || feed.matching.has(jobCompanyKey(c)));
  return { yours, extra, seconds: estimateSeconds([...yours, ...extra], readSpeeds(dataDir)) };
}

/**
 * A scan: every one of your companies, plus directory companies by scope, all fetched live. The
 * directory is only the list of companies and boards (sync it first: syncDirectory). Saves history
 * and the dashboard files; the progress file lets a stopped scan resume.
 */
export async function scan(config: Config, opts: ScanOptions): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const scope = opts.scope ?? "mine";
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
  const feed = fullScan && opts.feed !== false ? feedMatches(opts.dataDir, config.profile, now.getTime()) : undefined;
  const checks = feed ? inScope.filter((c) => !feed.covered.has(jobCompanyKey(c)) || feed.matching.has(jobCompanyKey(c))) : inScope;

  // Carry on a stopped scan of the same scope: skip what it fetched, keep what it found.
  const progressPath = join(opts.dataDir, progressFile(scope));
  const prior = fullScan && opts.resume !== false && !opts.dryRun ? readProgress(opts.dataDir, scope) : undefined;
  const resumed = prior && prior.scope === scope && now.getTime() - Date.parse(prior.startedAt) <= RESUME_WITHIN_MS ? prior : undefined;
  const done = new Set((resumed?.health ?? []).map((h) => h.key ?? jobCompanyKey(h)));
  const progress: Progress = { version: 1, scope, startedAt: resumed?.startedAt ?? now.toISOString(), health: [...(resumed?.health ?? [])], jobs: [...(resumed?.jobs ?? [])] };
  // Saved responses: a board that hasn't changed since the last scan answers with an empty 304.
  const cache = opts.http || opts.dryRun ? undefined : new FileHttpCache(join(opts.dataDir, "cache", "http"));
  const http = opts.http ?? new HttpClient({ cache, timeoutMs: 15_000, retries: 2, breakAfter: 3 });
  let lastSave = 0;
  const saveProgress = (force = false) => {
    if (!fullScan || opts.dryRun || (!force && Date.now() - lastSave < SAVE_EVERY_MS)) return;
    lastSave = Date.now();
    writeFileSync(progressPath, JSON.stringify(progress));
    cache?.save();
  };

  const only = opts.only?.map((s) => s.toLowerCase());
  const yours = checkOnly ? [] : config.companies.filter((c) => c.enabled && (!only?.length || only.includes(c.name.toLowerCase()) || only.includes(c.slug.toLowerCase())));
  const left = [...yours, ...checks].filter((c) => !done.has(jobCompanyKey(c)));
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
    ...(feed ? { skippedByFeed: inScope.length - checks.length } : {}),
    seconds: estimateSeconds(left, readSpeeds(opts.dataDir)),
    byAts,
    resumedByAts,
  });

  // "Check now" fetches only the asked-for companies; your own jobs are left as they are.
  const run = await runRadar(checkOnly ? { ...config, companies: [] } : config, {
    http,
    now,
    only: opts.only,
    previous,
    checks,
    skip: done,
    stopped: opts.stopped,
    industriesOf,
    onCompanyDone: opts.onCompanyDone,
    onCompanyResult: (h, jobs) => {
      progress.health.push(h);
      // Jobs that don't match you keep no description (as in history), so progress stays small.
      progress.jobs.push(...jobs.map((j) => (j.why.gate ? { ...j, description: undefined } : j)));
      saveProgress();
    },
  });
  const stopped = !!opts.stopped?.();
  const result: RunResult = resumed ? { ...run, startedAt: resumed.startedAt, jobs: [...resumed.jobs, ...run.jobs], health: [...resumed.health, ...run.health] } : run;
  if (checkOnly) result.partial = true;

  // Your companies whose board is gone, but which the directory lists on another board: a suggestion only.
  // Matching names proves nothing (anyone can open a board called "Acme"), so you check it and choose; nothing switches here.
  const moves = fullScan && !stopped ? findMoves(config, directory, result.health) : [];

  // Directory companies keep their matching jobs between scans (ledger), unless you've added or muted them since.
  // Only ones with matches (or that had some) are recorded, so a scan of the whole directory stays small.
  // One lookup per company: an "all" scan checks ~17,000, and a find() per company was ~10^8 comparisons.
  const matchesBy = new Map(result.health.map((h) => [`${h.ats}:${h.slug}`, h.matches]));
  const recorded = checks.filter((c) => (matchesBy.get(`${c.ats}:${c.slug}`) ?? 0) > 0 || !!ledger.companies[companyKey(c)]);
  ledger = recordChecks(ledger, recorded, result.health, now);
  const kept = keptChecked(ledger, now).filter((c) => !tracked.has(companyKey(c)) && !muted.has(companyKey(c)));
  const merged = mergeHistory(previous, result, [...config.companies, ...kept]);
  cache?.save();
  if (opts.dryRun) return { result, merged, checks, moves, stopped };

  // Run history keeps your companies and the directory ones that matched or failed, not every board.
  const yourKeys = new Set(config.companies.map(companyKey));
  const health = result.health.filter((h) => yourKeys.has(companyKey(h)) || h.matches > 0 || (!h.ok && !h.unsupported));
  const summary = saveRun(opts.dataDir, config, { ...result, health, checked: checks.length, ...(moves.length ? { moves } : {}) }, merged, { record: !checkOnly });
  writeLedger(opts.dataDir, ledger);
  if (!checkOnly) recordSpeeds(opts.dataDir, run.health);
  // The Radar shows only jobs fetched live; the shared index is for suggestions on the Companies page.
  if (fullScan) writeFileSync(join(opts.dataDir, "discover.json"), JSON.stringify({ version: 1, generatedAt: result.finishedAt, indexGeneratedAt: result.finishedAt, jobs: [] }));
  if (stopped) saveProgress(true);
  else if (fullScan) rmSync(progressPath, { force: true });
  return { result, merged, summary, checks, moves, stopped };
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
