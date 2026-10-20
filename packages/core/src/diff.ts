import { companyOfJobId, currentJobId, jobCompanyKey } from "./connectors";
import { byScore, type RunResult } from "./run";
import type { CompanyRef, Job } from "./schema";

/** A job missing from this many successful runs of its company in a row is closed. */
export const CLOSE_AFTER_MISSED_RUNS = 2;
/** Closed jobs are dropped this long after they were last seen. */
export const KEEP_CLOSED_DAYS = 60;
/** A job gone for less than this that comes back under a new id is a repost of it, not a new job. */
export const REPOST_WITHIN_DAYS = 60;

/** Same company, same title and place: what a repost keeps. */
const repostKey = (j: Pick<Job, "id" | "title" | "location">) => `${companyOfJobId(j.id)}|${j.title.toLowerCase().replace(/\s+/g, " ").trim()}|${j.location.toLowerCase().trim()}`;

export type MergeResult = {
  jobs: Job[];
  /**
   * Ids new to you in this run: listed for the first time ever, or first seen after the last recorded
   * run (a scan whose save stopped part-way kept its jobs in history but never counted or sent them).
   */
  newIds: Set<string>;
  /** Ids that closed in this run. */
  closedIds: Set<string>;
};

/**
 * Merge this run into the stored history: new / still open / missing / closed.
 * Jobs of companies that failed, weren't run this time or were read only in part (a capped
 * list) are left untouched, so a broken or cut-short feed never closes anything. Jobs of companies removed from the config are dropped.
 */
export function mergeHistory(
  previous: readonly Job[],
  run: RunResult,
  companies: readonly Pick<CompanyRef, "ats" | "slug" | "site">[],
  now = new Date(run.startedAt),
  opts: { lastRunAt?: string } = {},
): MergeResult {
  // Job ids carry their company's jobCompanyKey(); Workday and Taleo ones include the site.
  const configured = new Set(companies.map(jobCompanyKey));
  // A list cut short at a cap (partial) is no proof its other jobs closed: treat it like a failed fetch.
  const fetchedOk = new Set(run.health.filter((h) => h.ok && !h.partial).map((h) => h.key ?? jobCompanyKey(h)));
  const current = new Map(run.jobs.map((j) => [j.id, j]));
  // Older saves may hold ids in an earlier form; rewrite them so their history carries on.
  previous = previous.map((j) => {
    const id = currentJobId(j.id);
    return id === j.id ? j : { ...j, id };
  });
  const prevById = new Map(previous.map((j) => [j.id, j]));
  const cutoff = now.getTime() - KEEP_CLOSED_DAYS * 86_400_000;

  const newIds = new Set<string>();
  // Jobs in history first seen after the last recorded run were saved by a scan that never finished its save.
  const lastRun = opts.lastRunAt ? Date.parse(opts.lastRunAt) : Number.NaN;
  const unsent = (j: Job) => Number.isFinite(lastRun) && Date.parse(j.firstSeen) > lastRun;
  const closedIds = new Set<string>();
  const jobs: Job[] = [];

  // Jobs gone from their board that a new id could be a repost of (left out of history once taken over).
  const repostCutoff = now.getTime() - REPOST_WITHIN_DAYS * 86_400_000;
  const gone = new Map<string, Job>();
  for (const p of previous) if (!current.has(p.id) && Date.parse(p.lastSeen) >= repostCutoff && !gone.has(repostKey(p))) gone.set(repostKey(p), p);
  const reposted = new Set<string>();

  for (let j of run.jobs) {
    if (!prevById.has(j.id)) {
      const old = gone.get(repostKey(j));
      if (old) {
        gone.delete(repostKey(j));
        reposted.add(old.id);
        const posted = [old.postedAt ?? old.firstSeen, j.postedAt].filter((d): d is string => !!d).sort()[0];
        // Older saves have repostedAt without a count: that was one repost.
        const repostCount = (old.repostCount ?? (old.repostedAt ? 1 : 0)) + 1;
        j = { ...j, firstSeen: old.firstSeen, postedAt: posted, repostedAt: run.startedAt, repostCount };
      } else newIds.add(j.id);
    } else if (unsent(j)) newIds.add(j.id);
    jobs.push(j);
  }

  for (const p of previous) {
    if (current.has(p.id) || reposted.has(p.id)) continue;
    const key = companyOfJobId(p.id);
    if (!configured.has(key)) continue;
    if (!fetchedOk.has(key)) {
      if (p.status === "open" || Date.parse(p.lastSeen) >= cutoff) jobs.push(p);
      continue;
    }
    const missedRuns = (p.missedRuns ?? 0) + 1;
    if (p.status === "open" && missedRuns >= CLOSE_AFTER_MISSED_RUNS) {
      closedIds.add(p.id);
      jobs.push({ ...p, missedRuns, status: "closed", closedAt: run.startedAt });
    } else if (p.status === "open" || Date.parse(p.lastSeen) >= cutoff) {
      jobs.push({ ...p, missedRuns });
    }
  }

  jobs.sort(byScore);
  return { jobs, newIds, closedIds };
}
