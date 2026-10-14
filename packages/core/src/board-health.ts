import { join } from "node:path";
import { readJsonOrSetAside, writeFileAtomic } from "./atomic";
import { backoff } from "./backoff";
import { jobCompanyKey } from "./connectors";
import type { CompanyHealth, CompanyRef } from "./schema";

/**
 * How boards did across scans (data/board-health.json, keyed by jobCompanyKey()). A directory board
 * that keeps failing rests for a while instead of being asked again every scan, and one whose jobs
 * haven't changed for weeks is fetched less often (quiet); your own companies are always fetched.
 * Only boards that are failing, or whose job list has a fingerprint (for "quiet"), have an entry,
 * so the file stays small. Times are milliseconds since 1970.
 */
export type BoardRecord = {
  /** Failed fetches in a row; absent once one works. */
  fails?: number;
  /** The first failure of the current run of failures. */
  since?: number;
  /** The last failed fetch, and what kind of failure it was. */
  failedAt?: number;
  reason?: CompanyHealth["failure"];
  /** The first of the current run of definite "not here" answers (404, 410, board closed). */
  goneSince?: number;
  /** A second definite answer, at least DEAD_AFTER_HOURS after the first: the board is dead. */
  deadAt?: number;
  /** The last fetch that worked. */
  okAt?: number;
  /** A hash of the board's job ids (hashIds) at the last full read, and since when it's been that. */
  ids?: string;
  changedAt?: number;
};

export type BoardHealth = { version: 1; boards: Record<string, BoardRecord> };

const FILE = "board-health.json";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The longest a failing board rests between tries. */
export const MAX_REST_HOURS = 24;
/** No fetch that worked for this long: the board is chronic. */
export const CHRONIC_DAYS = 30;
/** Two definite "not here" answers this far apart make a board dead (one could be a hiccup). */
export const DEAD_AFTER_HOURS = 1;
/** A dead directory board is tried again after this long (or sooner with "Check now"). */
export const DEAD_REST_DAYS = 30;
/** A directory board unchanged this long is fetched at most once a day… */
export const QUIET_DAYS = 14;
/** …and unchanged this long, at most every 3 days. */
export const VERY_QUIET_DAYS = 45;
/** Entries of boards no scan covers any more are dropped this long after their last fetch. */
export const PRUNE_AFTER_DAYS = 60;

/** Worth keeping: failing, or with a job-list fingerprint. A bare { okAt } (older files kept one per board) is not. */
const worthKeeping = (r: BoardRecord) => !!r.fails || r.ids !== undefined;

export function readBoardHealth(dataDir: string): BoardHealth {
  const file = readJsonOrSetAside<BoardHealth>(join(dataDir, FILE));
  const boards: Record<string, BoardRecord> = {};
  if (file?.version === 1 && file.boards) for (const [key, r] of Object.entries(file.boards)) if (r && worthKeeping(r)) boards[key] = r;
  return { version: 1, boards };
}

/** Whole or not at all (writeFileAtomic): a crash mid-write leaves the last good file. */
export function writeBoardHealth(dataDir: string, health: BoardHealth): void {
  writeFileAtomic(join(dataDir, FILE), JSON.stringify(health));
}

/** Failing with no fetch that worked for CHRONIC_DAYS. */
export function isChronic(r: BoardRecord | undefined, now: number): boolean {
  return !!r?.fails && r.since !== undefined && now - r.since >= CHRONIC_DAYS * DAY_MS;
}

/** How long a failing board rests after its last failure: 1 h after the first, then 2, 4, 8, 16, 24 h at most. 0 when it isn't failing. */
export function restHours(r: BoardRecord | undefined): number {
  return r?.fails ? backoff(r.fails, 1, MAX_REST_HOURS) : 0;
}

/** A failing directory board whose rest isn't over: this scan leaves it alone. A dead one rests DEAD_REST_DAYS. */
export function isResting(r: BoardRecord | undefined, now: number): boolean {
  if (!r?.fails || r.failedAt === undefined) return false;
  if (r.deadAt !== undefined) return now - r.deadAt < DEAD_REST_DAYS * DAY_MS;
  return now - r.failedAt < restHours(r) * HOUR_MS;
}

/**
 * How often a board that works needs fetching, in hours, by how long its jobs have stayed the same:
 * 0 (every scan) until QUIET_DAYS, then a day, then 3 days from VERY_QUIET_DAYS. A board whose
 * jobs were never recorded is fetched every scan.
 */
export function quietHours(r: BoardRecord | undefined, now: number): number {
  if (r?.changedAt === undefined) return 0;
  const same = now - r.changedAt;
  return same >= VERY_QUIET_DAYS * DAY_MS ? 72 : same >= QUIET_DAYS * DAY_MS ? 24 : 0;
}

/** A board that worked last time, has kept the same jobs for weeks and was fetched recently enough. */
export function isQuiet(r: BoardRecord | undefined, now: number): boolean {
  return !r?.fails && r?.okAt !== undefined && now - r.okAt < quietHours(r, now) * HOUR_MS;
}

/**
 * Splits a scan's companies into those to fetch, directory boards resting after failing, and quiet
 * directory boards. A skipped board has no result this scan, so its jobs stay as they are (see
 * mergeHistory), like a board whose fetch failed; being quiet isn't a failure. `yours`
 * (jobCompanyKey()s of your companies) are never skipped, nor are `done` ones (a stopped scan
 * already fetched them).
 */
export function planBoards<T extends CompanyRef>(companies: readonly T[], health: BoardHealth, now: number, opts: { yours?: ReadonlySet<string>; done?: ReadonlySet<string> } = {}) {
  const fetch: T[] = [];
  const resting: T[] = [];
  const quiet: T[] = [];
  for (const c of companies) {
    const key = jobCompanyKey(c);
    const r = health.boards[key];
    if (opts.done?.has(key) || opts.yours?.has(key)) fetch.push(c);
    else if (isResting(r, now)) resting.push(c);
    else if (isQuiet(r, now)) quiet.push(c);
    else fetch.push(c);
  }
  return { fetch, resting, quiet };
}

/** A cheap fingerprint of a board's job ids (FNV-1a over the sorted ids): the same when the same jobs are listed. */
export function hashIds(ids: readonly string[]): string {
  const text = [...ids].sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * This scan's results into the record. A fetch that works ends the failures (and the entry, unless
 * it has a job-list fingerprint). Nothing is learnt, so nothing changes, when no request was made
 * (a hiring system we can't read yet, a host skipped after failing for other boards) or when our
 * own reading failed ("parse": the daily connector-health check finds those, not the board's record).
 */
export function recordBoards(health: BoardHealth, results: readonly CompanyHealth[], now: number): BoardHealth {
  const boards = { ...health.boards };
  for (const h of results) {
    if (h.unsupported || (!h.ok && (!h.failure || h.failure === "parse"))) continue;
    const key = h.key ?? jobCompanyKey(h);
    const prev = boards[key] ?? {};
    // The job-list fingerprint carries over failures: whether the jobs changed is about the list.
    const kept = { ...(prev.ids !== undefined ? { ids: prev.ids, changedAt: prev.changedAt } : {}), ...(prev.okAt !== undefined ? { okAt: prev.okAt } : {}) };
    if (h.ok) {
      // A full read says whether the jobs changed; the first one starts the clock.
      const changed = h.idsHash !== undefined && (h.idsHash !== prev.ids || prev.changedAt === undefined);
      const next: BoardRecord = { ...kept, okAt: now, ...(changed ? { ids: h.idsHash, changedAt: now } : {}) };
      if (worthKeeping(next)) boards[key] = next;
      else delete boards[key];
      continue;
    }
    const next: BoardRecord = { ...kept, fails: (prev.fails ?? 0) + 1, since: prev.fails ? (prev.since ?? now) : now, failedAt: now, reason: h.failure };
    // Dead only on a second definite answer at least an hour after the first; any other failure
    // (timeout, 5xx, 429…) breaks the run, so it says nothing about whether the board is there.
    if (h.failure === "gone") {
      next.goneSince = prev.goneSince ?? now;
      // Each later definite answer starts the dead board's rest again.
      if (now - next.goneSince >= DEAD_AFTER_HOURS * HOUR_MS) next.deadAt = now;
    }
    boards[key] = next;
  }
  return { version: 1, boards };
}

/** Drops boards the scan's scope doesn't cover any more once their last fetch is PRUNE_AFTER_DAYS old. */
export function pruneBoards(health: BoardHealth, inScope: ReadonlySet<string>, now: number): BoardHealth {
  const cutoff = now - PRUNE_AFTER_DAYS * DAY_MS;
  const boards: Record<string, BoardRecord> = {};
  for (const [key, r] of Object.entries(health.boards)) if (inScope.has(key) || Math.max(r.okAt ?? 0, r.failedAt ?? 0) >= cutoff) boards[key] = r;
  return { version: 1, boards };
}
