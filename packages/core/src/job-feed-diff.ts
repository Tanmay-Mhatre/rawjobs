import { createHash } from "node:crypto";
import type { Workplace } from "./schema";

/**
 * [ats job id, title, location, workplace, posted date (YYYY-MM-DD) or null, and, when the build looked
 * it up (Workday), where a vague location ("3 Locations") actually is]. No field holds a tab or a line break.
 */
export type FeedRow = [id: string, title: string, location: string, workplace: Workplace, posted: string | null, resolved?: string];

/**
 * The job feed's change-file formats: one full copy for new installs plus a small change file per run,
 * so an install that's up to date downloads only what changed (the way OpenStreetMap ships map updates).
 * Only a few % of jobs change between runs, so a change file lists jobs, not companies. Shared by the
 * feed build (scripts/catalog/jobs.ts) and the app (job-feed.ts).
 *
 * Schema 2: JSON full copies, the five original hiring systems (kept for apps from before schema 3).
 * Schema 3: every hiring system, full copies in the compact text format (job-feed-compact.ts).
 */
export const JOB_FEED_SCHEMA_V2 = 2;
export const JOB_FEED_SCHEMA_V3 = 3;

/**
 * Every company's jobs and when they were last read (ISO time; older feeds: YYYY-MM-DD), by
 * jobCompanyKey(). `partial`: companies whose board stopped at a cap, so not every job is listed.
 */
export type FeedState = { verified: Record<string, string>; jobs: Record<string, FeedRow[]>; partial?: string[] };

/** A full copy of the second format (jobs-v2-snapshot-<seq>.json.br). */
export type FeedSnapshot = FeedState & { schema: number; seq: number; generated_at: string };

/** One run's changes (jobs-v<n>-diff-<seq>.json.br), turning the state after `seq - 1` into the state after `seq`. */
export type FeedDiff = {
  schema: number;
  seq: number;
  generated_at: string;
  /** When every company was read (ISO time; older feeds: the day), unless listed in `stale` or `verified_on`. */
  date: string;
  /** Companies not read this run (failed, or out of time): they keep when they were last read. */
  stale: string[];
  /** Companies whose time is neither `date` nor what it was. */
  verified_on: Record<string, string>;
  /** Companies gone from the feed. */
  removed: string[];
  /** Per company: job ids that closed or changed, then jobs that are new or changed. A new company lists all its jobs. */
  changes: Record<string, { remove?: string[]; add?: FeedRow[] }>;
  /** Schema 3: every partial company after this change. */
  partial?: string[];
};

export type FeedManifestV2 = {
  schema: number;
  seq: number;
  generated_at: string;
  /** feedStateHash() of the state after `seq`. */
  state_sha256: string;
  companies: number;
  jobs: number;
  snapshot: { file: string; sha256: string; bytes: number };
  /** The most recent change files, oldest first; each one's `state_sha256` is the state after it. */
  diffs: { seq: number; file: string; sha256: string; bytes: number; state_sha256: string }[];
  /** Hiring activity (activity.ts): optional, older apps ignore it, and a run that couldn't make it leaves it out. */
  activity?: { file: string; sha256: string; bytes: number };
};

const byId = (a: FeedRow, b: FeedRow) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** A fingerprint of a state that doesn't depend on key or job order: the app checks its copy against it. */
export function feedStateHash(state: FeedState): string {
  return feedHashOf(Object.keys(state.jobs), state.verified, new Set(state.partial ?? []), (key) => state.jobs[key]!);
}

/** feedStateHash over any store of rows: `rowsOf` is called once per company, in key order. */
export function feedHashOf(keys: Iterable<string>, verified: Record<string, string>, partial: ReadonlySet<string>, rowsOf: (key: string) => FeedRow[]): string {
  const h = new FeedHasher();
  for (const key of [...keys].sort()) h.add(key, verified[key] ?? "", partial.has(key), rowsOf(key));
  return h.digest();
}

/** feedStateHash one company at a time; companies must come in key order (JavaScript's default sort). */
export class FeedHasher {
  private readonly h = createHash("sha256");
  add(key: string, verified: string, partial: boolean, rows: FeedRow[]) {
    // "partial" only for partial companies, so a state without any hashes as the second format always did.
    this.h.update(`${key}\t${verified}\t${partial ? "partial\t" : ""}`);
    this.h.update(JSON.stringify([...rows].sort(byId)));
    this.h.update("\n");
  }
  digest() {
    return this.h.digest("hex");
  }
}

/** What turns `before` into `after`. */
export function diffFeedStates(before: FeedState, after: FeedState, meta: { schema?: number; seq: number; generated_at: string; date: string }): FeedDiff {
  const diff: FeedDiff = { schema: JOB_FEED_SCHEMA_V2, ...meta, stale: [], verified_on: {}, removed: [], changes: {} };
  if (after.partial) diff.partial = [...after.partial].sort();
  for (const key of Object.keys(before.jobs)) if (!(key in after.jobs)) diff.removed.push(key);
  for (const [key, rows] of Object.entries(after.jobs)) {
    const day = after.verified[key] ?? meta.date;
    const was = before.verified[key];
    if (day !== meta.date) {
      if (day === was) diff.stale.push(key);
      else diff.verified_on[key] = day;
    }
    const old = before.jobs[key];
    if (!old) {
      diff.changes[key] = { add: rows };
      continue;
    }
    const oldById = new Map(old.map((r) => [r[0], JSON.stringify(r)]));
    const newById = new Map(rows.map((r) => [r[0], JSON.stringify(r)]));
    // A job whose title, place or date changed is removed and added again.
    const remove = old.filter((r) => newById.get(r[0]) !== oldById.get(r[0])).map((r) => r[0]);
    const add = rows.filter((r) => oldById.get(r[0]) !== newById.get(r[0]));
    if (remove.length || add.length) diff.changes[key] = { ...(remove.length ? { remove } : {}), ...(add.length ? { add } : {}) };
  }
  return diff;
}

/** Apply one change file to a state, in place. Returns the companies whose jobs changed. */
export function applyFeedDiff(state: FeedState, diff: FeedDiff): string[] {
  for (const key of diff.removed) {
    delete state.jobs[key];
    delete state.verified[key];
  }
  const changed: string[] = [];
  for (const [key, { remove, add }] of Object.entries(diff.changes)) {
    const gone = new Set(remove ?? []);
    state.jobs[key] = [...(state.jobs[key] ?? []).filter((r) => !gone.has(r[0])), ...(add ?? [])];
    changed.push(key);
  }
  if (diff.partial) state.partial = [...diff.partial];
  const stale = new Set(diff.stale);
  for (const key of Object.keys(state.jobs)) {
    if (diff.verified_on[key]) state.verified[key] = diff.verified_on[key]!;
    else if (!stale.has(key)) state.verified[key] = diff.date;
  }
  return changed;
}
