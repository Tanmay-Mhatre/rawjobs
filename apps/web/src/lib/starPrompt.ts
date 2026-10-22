import type { RunSummary } from "./data";
import type { UserState } from "./userState";

/**
 * The "Star on GitHub" question: asked on the Radar once you've used RawJobs for a while and got
 * something out of it, at most twice, never again once answered. Nothing about it leaves this computer.
 */
export const STAR_KEY = "rawjobs.starPrompt";

export type StarPrompt = {
  /** When this computer first used RawJobs, as far as we can tell (ISO). */
  firstSeen?: string;
  /** Each time it was put off ("Remind me later", Escape), oldest first. */
  later?: string[];
  /** Answered for good: opened the GitHub page, or "Don't ask again". */
  answer?: "starred" | "never";
};

const DAY = 86_400_000;
/** Days of use before it asks. */
export const STAR_AFTER_DAYS = 7;
/** Days after "Remind me later" before it asks the second and last time. */
export const STAR_AGAIN_DAYS = 30;
/** Finished scans that count as getting something out of it, as much as one job applied to. */
export const STAR_SCANS = 5;
/** meta.json keeps only the latest runs (KEEP_RUNS in core/store.ts), so a full list means "at least". */
export const RUNS_KEPT = 30;

export type StarFacts = { days: number; scans: number; applied: number };

/** Jobs you applied to: in Applied or a stage after it now, or there at some point. */
function appliedCount(state: UserState): number {
  let n = 0;
  for (const e of Object.values(state)) {
    if (e.status === "applied" || e.status === "interviewing" || e.status === "offer" || e.history?.some((h) => h.status === "applied")) n++;
  }
  return n;
}

/**
 * For people who used RawJobs before the question existed: the earliest scan or tracking change we
 * still have, or now.
 */
export function firstSeenFrom(state: UserState, runs: readonly RunSummary[], now: number): string {
  let first = now;
  const seen = (at: string | undefined) => {
    const t = at ? Date.parse(at) : NaN;
    if (t < first) first = t;
  };
  for (const r of runs) seen(r.startedAt);
  for (const e of Object.values(state)) {
    seen(e.updatedAt);
    for (const h of e.history ?? []) seen(h.at);
  }
  return new Date(first).toISOString();
}

export function starFacts(p: StarPrompt, state: UserState, runs: readonly RunSummary[], now: number): StarFacts {
  const since = p.firstSeen ? Date.parse(p.firstSeen) : now;
  return { days: Math.max(0, Math.floor((now - since) / DAY)), scans: runs.length, applied: appliedCount(state) };
}

/** Whether to ask now. */
export function starDue(p: StarPrompt, facts: StarFacts, now: number): boolean {
  if (p.answer) return false;
  const later = p.later ?? [];
  if (later.length >= 2) return false;
  const [put] = later;
  if (put && now - Date.parse(put) < STAR_AGAIN_DAYS * DAY) return false;
  return facts.days >= STAR_AFTER_DAYS && (facts.applied >= 1 || facts.scans >= STAR_SCANS);
}
