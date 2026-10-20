import { load, save } from "./storage";

const KEY = "rawjobs.radar.seen";

/** The latest scan you've had the Radar open for, and the scan you'd seen before it. */
export type Seen = { latest: string; since?: string };

/**
 * "New" is new since your last visit, not since the last scan: with three scans in a day and one look,
 * all three scans' finds are new. When a scan you haven't seen yet is there, what you'd seen becomes the
 * line; until the next one, the same jobs stay New (a reload doesn't clear them). With nothing stored
 * yet, the previous scan is the line, as before.
 */
export function advanceSeen(stored: Seen | null, latest: string | undefined, previous: string | undefined): Seen | null {
  if (!latest) return stored;
  // Nothing stored, or data older than what you'd seen (started over): the previous scan is the line.
  if (!stored || Date.parse(latest) < Date.parse(stored.latest)) return { latest, since: previous };
  if (Date.parse(latest) > Date.parse(stored.latest)) return { latest, since: stored.latest };
  return stored;
}

/** When "new" starts for this visit (ms), and the visit recorded for next time. */
export function newSinceLastVisit(latest: string | undefined, previous: string | undefined): number | undefined {
  const stored = load<Seen | null>(KEY, null);
  const next = advanceSeen(stored, latest, previous);
  if (next && next !== stored) save(KEY, next);
  return next?.since ? Date.parse(next.since) : undefined;
}

/**
 * The "new" context for the feed, the job drawer and To review: no New tags on your first scan, and
 * new means first found since your last visit. Partial scans (one company, Scan now's picks) don't count.
 */
export function newCtx(runs: readonly { partial?: boolean; finishedAt: string }[]): { firstScan: boolean; newSince?: number } {
  const full = runs.filter((r) => !r.partial);
  return { firstScan: full.length <= 1, newSince: newSinceLastVisit(full[0]?.finishedAt, full[1]?.finishedAt) };
}
