import { createHash } from "node:crypto";
import type { Workplace } from "./schema";

/** [ats job id, title, location, workplace, posted date (YYYY-MM-DD) or null] */
export type FeedRow = [string, string, string, Workplace, string | null];

/**
 * The job feed's second format (schema 2): one full copy for new installs plus a small change file per
 * day, so an install that's up to date downloads only what changed (the way OpenStreetMap ships map
 * updates). About 31% of companies change on a given day, but only ~5% of jobs, so a change file lists
 * jobs, not companies. Shared by the daily build (scripts/catalog/jobs.ts) and the app (job-feed.ts).
 */
export const JOB_FEED_SCHEMA_V2 = 2;

/** Every company's jobs and the day they were last read (YYYY-MM-DD), by jobCompanyKey(). */
export type FeedState = { verified: Record<string, string>; jobs: Record<string, FeedRow[]> };

/** A full copy (jobs-v2-snapshot-<seq>.json.br). */
export type FeedSnapshot = FeedState & { schema: number; seq: number; generated_at: string };

/** One day's changes (jobs-v2-diff-<seq>.json.br), turning the state after `seq - 1` into the state after `seq`. */
export type FeedDiff = {
  schema: number;
  seq: number;
  generated_at: string;
  /** The day every company was read, unless listed in `stale` or `verified_on`. */
  date: string;
  /** Companies not read today (failed, or out of time): they keep the day they were last read. */
  stale: string[];
  /** Companies whose day is neither `date` nor what it was. */
  verified_on: Record<string, string>;
  /** Companies gone from the feed. */
  removed: string[];
  /** Per company: job ids that closed or changed, then jobs that are new or changed. A new company lists all its jobs. */
  changes: Record<string, { remove?: string[]; add?: FeedRow[] }>;
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
  const h = createHash("sha256");
  for (const key of Object.keys(state.jobs).sort()) {
    h.update(`${key}\t${state.verified[key] ?? ""}\t`);
    h.update(JSON.stringify([...state.jobs[key]!].sort(byId)));
    h.update("\n");
  }
  return h.digest("hex");
}

/** What turns `before` into `after`. */
export function diffFeedStates(before: FeedState, after: FeedState, meta: { seq: number; generated_at: string; date: string }): FeedDiff {
  const diff: FeedDiff = { schema: JOB_FEED_SCHEMA_V2, ...meta, stale: [], verified_on: {}, removed: [], changes: {} };
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
  const stale = new Set(diff.stale);
  for (const key of Object.keys(state.jobs)) {
    if (diff.verified_on[key]) state.verified[key] = diff.verified_on[key]!;
    else if (!stale.has(key)) state.verified[key] = diff.date;
  }
  return changed;
}
