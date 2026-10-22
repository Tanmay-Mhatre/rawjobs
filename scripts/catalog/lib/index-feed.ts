/**
 * The job index's rows from the shared job feed (jobs.ts reads the same boards every 6 hours), so the
 * weekly rebuild reads live only the boards the feed lacks or hasn't read lately.
 */
import { jobCompanyKey, type FeedState, type NormalizedJob } from "@rawjobs/core";

/** [title, location, workplace, ageDays, count] */
export type IndexRow = [string, string, string, number | null, number];
export type IndexEntry = { key: string; ats: string; slug: string; region?: string; name: string; status: string };
type Job = Pick<NormalizedJob, "title" | "location" | "workplace" | "postedAt">;

/** Rows kept per company after merging duplicates (newest first). */
export const MAX_ROWS = 300;

/** A company's jobs as index rows: one per title and location, with the newest age and a count. */
export function toRows(jobs: Job[], now: number): IndexRow[] {
  const merged = new Map<string, IndexRow>();
  for (const j of jobs) {
    const age = j.postedAt ? Math.max(0, Math.round((now - Date.parse(j.postedAt)) / 86_400_000)) : null;
    const k = `${j.title}\u0000${j.location}`;
    const prev = merged.get(k);
    if (prev) {
      prev[4]++;
      if (age !== null && (prev[3] === null || age < prev[3])) prev[3] = age;
    } else merged.set(k, [j.title, j.location, j.workplace, Number.isFinite(age) ? age : null, 1]);
  }
  return [...merged.values()].sort((a, b) => (a[3] ?? 9999) - (b[3] ?? 9999)).slice(0, MAX_ROWS);
}

export type IndexLine = { key: string; fetched_at: string; open_jobs: number; rows: IndexRow[] };
export type IndexPlan = {
  /** Lines taken from the feed, with the feed's read time. */
  fromFeed: IndexLine[];
  /** Companies to read live. */
  live: IndexEntry[];
  /** Companies the feed has but read more than `maxAgeDays` ago. */
  stale: number;
  /** Companies already indexed recently enough: neither the feed nor a live read is needed. */
  fresh: number;
};

/**
 * Which companies come from the feed and which are read live. A feed company counts only when the feed
 * read it within `maxAgeDays` (the index's own re-fetch age) and more recently than the index did. Two
 * directory entries with the same feed key (one board under two regions) are read live: the feed keeps
 * only one of them. Without a feed, everything not fresh is read live, as before.
 */
export function planIndex(todo: IndexEntry[], feed: FeedState | undefined, indexed: Map<string, string>, opts: { now: number; maxAgeDays: number }): IndexPlan {
  const cutoff = opts.now - opts.maxAgeDays * 86_400_000;
  const shared = new Map<string, number>();
  for (const e of todo) shared.set(jobCompanyKey(e), (shared.get(jobCompanyKey(e)) ?? 0) + 1);
  const plan: IndexPlan = { fromFeed: [], live: [], stale: 0, fresh: 0 };
  for (const e of todo) {
    const had = indexed.get(e.key);
    const k = jobCompanyKey(e);
    const read = feed && shared.get(k) === 1 ? feed.verified[k] : undefined;
    const rows = read ? feed!.jobs[k] : undefined;
    if (read && rows) {
      if (Date.parse(read) < cutoff) plan.stale++;
      else if (had && Date.parse(had) >= Date.parse(read)) {
        plan.fresh++;
        continue;
      } else {
        const jobs = rows.map(([, title, location, workplace, posted]) => ({ title, location, workplace, postedAt: posted ?? undefined }));
        plan.fromFeed.push({ key: e.key, fetched_at: new Date(read).toISOString(), open_jobs: jobs.length, rows: toRows(jobs, opts.now) });
        continue;
      }
    }
    if (had && Date.parse(had) >= cutoff) plan.fresh++;
    else plan.live.push(e);
  }
  return plan;
}
