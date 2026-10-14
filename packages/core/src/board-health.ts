import { join } from "node:path";
import { readJsonOrSetAside, writeFileAtomic } from "./atomic";
import { backoff } from "./backoff";
import { jobCompanyKey } from "./connectors";
import type { CompanyHealth, CompanyRef } from "./schema";

/**
 * Boards that are failing, across scans (data/board-health.json, keyed by jobCompanyKey()). A
 * directory board that keeps failing rests for a while instead of being asked again every scan;
 * your own companies are always fetched. A board that works has no entry, so the file stays small
 * even for an "all" scan. Times are milliseconds since 1970.
 */
export type BoardRecord = {
  /** Failed fetches in a row. */
  fails: number;
  /** The first failure of the current run of failures. */
  since: number;
  /** The last failed fetch, and what kind of failure it was. */
  failedAt: number;
  reason?: CompanyHealth["failure"];
  /** The first of the current run of definite "not here" answers (404, 410, board closed). */
  goneSince?: number;
  /** A second definite answer, at least DEAD_AFTER_HOURS after the first: the board is dead. */
  deadAt?: number;
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
/** Entries of boards no scan covers any more are dropped this long after their last failure. */
export const PRUNE_AFTER_DAYS = 60;

export function readBoardHealth(dataDir: string): BoardHealth {
  const file = readJsonOrSetAside<{ version?: number; boards?: Record<string, Partial<BoardRecord>> }>(join(dataDir, FILE));
  const boards: Record<string, BoardRecord> = {};
  // Files from before 0.6.x also kept boards that worked ({ okAt }): those are dropped here.
  if (file?.version === 1 && file.boards)
    for (const [key, r] of Object.entries(file.boards)) if (r.fails && r.since !== undefined && r.failedAt !== undefined) boards[key] = withoutOkAt(r as BoardRecord);
  return { version: 1, boards };
}

function withoutOkAt(r: BoardRecord & { okAt?: number }): BoardRecord {
  const { okAt: _ok, ...rest } = r;
  return rest;
}

/** Whole or not at all (writeFileAtomic): a crash mid-write leaves the last good file. */
export function writeBoardHealth(dataDir: string, health: BoardHealth): void {
  writeFileAtomic(join(dataDir, FILE), JSON.stringify(health));
}

/** Failing with no fetch that worked for CHRONIC_DAYS. */
export function isChronic(r: BoardRecord | undefined, now: number): boolean {
  return !!r?.fails && now - r.since >= CHRONIC_DAYS * DAY_MS;
}

/** How long a failing board rests after its last failure: 1 h after the first, then 2, 4, 8, 16, 24 h at most. 0 when it isn't failing. */
export function restHours(r: BoardRecord | undefined): number {
  return r?.fails ? backoff(r.fails, 1, MAX_REST_HOURS) : 0;
}

/** A failing directory board whose rest isn't over: this scan leaves it alone. A dead one rests DEAD_REST_DAYS. */
export function isResting(r: BoardRecord | undefined, now: number): boolean {
  if (!r?.fails) return false;
  if (r.deadAt !== undefined) return now - r.deadAt < DEAD_REST_DAYS * DAY_MS;
  return now - r.failedAt < restHours(r) * HOUR_MS;
}

/**
 * Splits a scan's companies into those to fetch and those resting. A skipped board has no result
 * this scan, so its jobs stay as they are (see mergeHistory), like a board whose fetch failed.
 * Only directory boards rest: `yours` (jobCompanyKey()s of your companies) are always fetched, and
 * so are `done` ones (a stopped scan already fetched them).
 */
export function planBoards<T extends CompanyRef>(companies: readonly T[], health: BoardHealth, now: number, opts: { yours?: ReadonlySet<string>; done?: ReadonlySet<string> } = {}) {
  const fetch: T[] = [];
  const resting: T[] = [];
  for (const c of companies) {
    const key = jobCompanyKey(c);
    (!opts.done?.has(key) && !opts.yours?.has(key) && isResting(health.boards[key], now) ? resting : fetch).push(c);
  }
  return { fetch, resting };
}

/**
 * This scan's results into the record. A fetch that works removes the board. Nothing is learnt,
 * so nothing changes, when no request was made (a hiring system we can't read yet, a host skipped
 * after failing for other boards) or when our own reading failed ("parse": the daily
 * connector-health check finds those, not the board's record).
 */
export function recordBoards(health: BoardHealth, results: readonly CompanyHealth[], now: number): BoardHealth {
  const boards = { ...health.boards };
  for (const h of results) {
    if (h.unsupported || (!h.ok && (!h.failure || h.failure === "parse"))) continue;
    const key = h.key ?? jobCompanyKey(h);
    if (h.ok) {
      delete boards[key];
      continue;
    }
    const prev = boards[key];
    const next: BoardRecord = { fails: (prev?.fails ?? 0) + 1, since: prev?.since ?? now, failedAt: now, reason: h.failure };
    // Dead only on a second definite answer at least an hour after the first; any other failure
    // (timeout, 5xx, 429…) breaks the run, so it says nothing about whether the board is there.
    if (h.failure === "gone") {
      next.goneSince = prev?.goneSince ?? now;
      // Each later definite answer starts the dead board's rest again.
      if (now - next.goneSince >= DEAD_AFTER_HOURS * HOUR_MS) next.deadAt = now;
    }
    boards[key] = next;
  }
  return { version: 1, boards };
}

/** Drops boards the scan's scope doesn't cover any more once their last failure is PRUNE_AFTER_DAYS old. */
export function pruneBoards(health: BoardHealth, inScope: ReadonlySet<string>, now: number): BoardHealth {
  const cutoff = now - PRUNE_AFTER_DAYS * DAY_MS;
  const boards: Record<string, BoardRecord> = {};
  for (const [key, r] of Object.entries(health.boards)) if (inScope.has(key) || r.failedAt >= cutoff) boards[key] = r;
  return { version: 1, boards };
}
