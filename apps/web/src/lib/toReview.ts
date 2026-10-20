import type { Job } from "./data";
import { roleOf } from "./identity";
import { hiddenByRules, type HideRule } from "./notForMe";
import type { UserState } from "./userState";

/** To review holds this many jobs; the rest are on the Radar ("See all N on the Radar"). */
export const REVIEW_MAX = 12;
/** A job is up for review this many days after it was first found. */
export const REVIEW_DAYS = 7;

export type ReviewCtx = {
  user: UserState;
  /** Strong-match score (the profile's min_score). */
  min: number;
  hiddenCompanies: ReadonlySet<string>;
  hideRules?: readonly HideRule[];
  now?: number;
};

/**
 * The Pipeline's To review column: strong matches first found in the last REVIEW_DAYS days that you
 * haven't tracked (or said Not interested to) and haven't hidden (a hidden company, a hide rule, or
 * a failed must-have), one posting per role, newest first. `total` counts them all; `jobs` is the
 * first REVIEW_MAX.
 */
export function toReview(jobs: readonly Job[], ctx: ReviewCtx, limit = REVIEW_MAX): { jobs: Job[]; total: number } {
  const now = ctx.now ?? Date.now();
  const from = now - REVIEW_DAYS * 864e5;
  // A role you already track (any of its postings) isn't up for review again.
  const tracked = new Set(jobs.filter((j) => ctx.user[j.id]?.status).map(roleOf));
  const byRole = new Map<string, Job>();
  for (const j of jobs) {
    const seen = Date.parse(j.firstSeen);
    if (j.score < ctx.min || !(seen >= from) || j.status === "closed" || j.why.gate) continue;
    if (ctx.hiddenCompanies.has(j.company) || hiddenByRules(j, ctx.hideRules)) continue;
    const role = roleOf(j);
    if (tracked.has(role)) continue;
    const kept = byRole.get(role);
    if (!kept || seen > Date.parse(kept.firstSeen)) byRole.set(role, j);
  }
  const all = [...byRole.values()].sort((a, b) => Date.parse(b.firstSeen) - Date.parse(a.firstSeen));
  return { jobs: all.slice(0, limit), total: all.length };
}
