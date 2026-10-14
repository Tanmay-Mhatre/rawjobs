import { join } from "node:path";
import { readJsonOrSetAside, writeFileAtomic } from "./atomic";
import { jobCompanyKey } from "./connectors";
import type { CompanyHealth, CompanyRef } from "./schema";

/**
 * How each board did across scans (data/board-health.json, keyed by jobCompanyKey()). A board that
 * keeps failing rests for a while instead of being asked again every scan, and a directory board
 * whose jobs haven't changed for weeks is fetched less often (quiet). Times are milliseconds
 * since 1970, to keep the file small: an "all" scan records one entry per board it fetched.
 */
export type BoardRecord = {
  /** Failed fetches in a row; absent once one works. */
  fails?: number;
  /** The first failure of the current run of failures. */
  since?: number;
  /** The last failed fetch, and what kind of failure it was ("gone" only for a definite answer). */
  failedAt?: number;
  reason?: CompanyHealth["failure"];
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
/** Your own companies are tried again sooner: they're what you asked for. */
export const MAX_REST_HOURS_YOURS = 6;
/** No fetch that worked for this long: the board is chronic (shown in the scan's output, rested the longest). */
export const CHRONIC_DAYS = 30;
/** A directory board unchanged this long is fetched at most once a day… */
export const QUIET_DAYS = 14;
/** …and unchanged this long, at most every 3 days. */
export const VERY_QUIET_DAYS = 45;
/** Entries of boards no scan covers any more are dropped this long after their last fetch. */
export const PRUNE_AFTER_DAYS = 60;

export function readBoardHealth(dataDir: string): BoardHealth {
  const file = readJsonOrSetAside<BoardHealth>(join(dataDir, FILE));
  return file?.version === 1 && file.boards ? file : { version: 1, boards: {} };
}

/** Whole or not at all (writeFileAtomic): a crash mid-write leaves the last good file. */
export function writeBoardHealth(dataDir: string, health: BoardHealth): void {
  writeFileAtomic(join(dataDir, FILE), JSON.stringify(health));
}

/** Failing with no fetch that worked for CHRONIC_DAYS. */
export function isChronic(r: BoardRecord | undefined, now: number): boolean {
  return !!r?.fails && r.since !== undefined && now - r.since >= CHRONIC_DAYS * DAY_MS;
}

/**
 * How long a failing board rests after its last failure: 1 h after the first, then 2, 4, 8… up to
 * a day (a chronic board, the full day). Your own companies rest at most MAX_REST_HOURS_YOURS. 0 when it isn't failing.
 */
export function restHours(r: BoardRecord | undefined, now: number, yours = false): number {
  if (!r?.fails) return 0;
  const hours = isChronic(r, now) ? MAX_REST_HOURS : Math.min(2 ** (r.fails - 1), MAX_REST_HOURS);
  return yours ? Math.min(hours, MAX_REST_HOURS_YOURS) : hours;
}

/** The board's last fetch failed and its rest isn't over: this scan leaves it alone. */
export function isResting(r: BoardRecord | undefined, now: number, yours = false): boolean {
  return !!r?.fails && r.failedAt !== undefined && now - r.failedAt < restHours(r, now, yours) * HOUR_MS;
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
 * Splits a scan's companies into those to fetch, those resting after failing and quiet ones (never
 * yours). A skipped board has no result this scan, so its jobs stay as they are (see mergeHistory),
 * like a board whose fetch failed; being quiet isn't a failure.
 * `yours`: jobCompanyKey()s of your companies; `done`: ones a stopped scan already fetched (never skipped).
 */
export function planBoards<T extends CompanyRef>(companies: readonly T[], health: BoardHealth, now: number, opts: { yours?: ReadonlySet<string>; done?: ReadonlySet<string> } = {}) {
  const fetch: T[] = [];
  const resting: T[] = [];
  const quiet: T[] = [];
  for (const c of companies) {
    const key = jobCompanyKey(c);
    const r = health.boards[key];
    const yours = !!opts.yours?.has(key);
    if (opts.done?.has(key)) fetch.push(c);
    else if (isResting(r, now, yours)) resting.push(c);
    else if (!yours && isQuiet(r, now)) quiet.push(c);
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
 * This scan's results into the record. Boards no request was made for (a hiring system we can't
 * read yet, a host skipped after failing for other boards) aren't recorded: nothing was learnt.
 */
export function recordBoards(health: BoardHealth, results: readonly CompanyHealth[], now: number): BoardHealth {
  const boards = { ...health.boards };
  for (const h of results) {
    if (h.unsupported || (!h.ok && !h.failure)) continue;
    const key = h.key ?? jobCompanyKey(h);
    const prev = boards[key] ?? {};
    if (h.ok) {
      const { fails: _f, since: _s, failedAt: _a, reason: _r, ...rest } = prev;
      // A full read says whether the jobs changed; the first one starts the clock.
      const changed = h.idsHash !== undefined && (h.idsHash !== prev.ids || prev.changedAt === undefined);
      boards[key] = { ...rest, okAt: now, ...(changed ? { ids: h.idsHash, changedAt: now } : {}) };
    } else {
      boards[key] = { ...prev, fails: (prev.fails ?? 0) + 1, since: prev.fails ? (prev.since ?? now) : now, failedAt: now, reason: h.failure };
    }
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
