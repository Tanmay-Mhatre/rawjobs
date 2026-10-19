import { type Entry, type Status, stageSince, type UserState } from "./userState";

const DAY = 864e5;
/** Steps that mean the company answered: an interview, an offer, or a rejection (closed as Rejected). */
const replied = (e: Entry, s: Status | null) => s === "interviewing" || s === "offer" || (s === "rejected" && e.closedAs === "rejected");

/** When the job was applied to, if it ever was: its Applied step, else (tracked straight at a later stage) its first step. */
function appliedAt(e: Entry): string | undefined {
  const h = e.history ?? [];
  const applied = h.find((x) => x.status === "applied")?.at;
  if (applied) return applied;
  if (e.status === "applied") return stageSince(e);
  // Tracked straight at Interviewing or Offer: it was applied to, at or before its first step.
  const first = h.find((x) => x.status !== null && x.status !== "saved" && x.status !== "dismissed");
  return first?.at ?? (e.status === "interviewing" || e.status === "offer" ? e.updatedAt : undefined);
}

/** When the company first answered, if it did. */
const repliedAt = (e: Entry): string | undefined => (e.history ?? []).find((x) => replied(e, x.status))?.at ?? (replied(e, e.status ?? null) ? stageSince(e) : undefined);

export type Band = { label: string; applied: number; replied: number };

export type PipelineStats = {
  /** Applied to in the last 30 days. */
  applied30: number;
  /** Applied to in the current week (from Monday). */
  appliedThisWeek: number;
  /** Ever applied to. */
  applied: number;
  /** Of those, how many got an answer (interview, offer or rejection). */
  replied: number;
  /** Closed as No response: ghosted. */
  ghosted: number;
  /** Median days from applying to the first answer, when there's at least one. */
  medianDaysToReply?: number;
  /** Reply rate by fit score, for jobs RawJobs scored (not ones added by hand). */
  bands: Band[];
};

/** Monday 00:00 local time of `now`'s week. */
export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function pipelineStats(state: UserState, now = new Date()): PipelineStats {
  const monday = weekStart(now).getTime();
  const bands: Band[] = [
    { label: "Score 80+", applied: 0, replied: 0 },
    { label: "Score 65–79", applied: 0, replied: 0 },
    { label: "Below 65", applied: 0, replied: 0 },
  ];
  let applied = 0;
  let applied30 = 0;
  let appliedThisWeek = 0;
  let answered = 0;
  let ghosted = 0;
  const waits: number[] = [];
  for (const [id, e] of Object.entries(state)) {
    const at = appliedAt(e);
    if (!at) continue;
    applied++;
    const t = Date.parse(at);
    if (now.getTime() - t <= 30 * DAY) applied30++;
    if (t >= monday) appliedThisWeek++;
    const reply = repliedAt(e);
    if (reply) {
      answered++;
      waits.push(Math.max(0, (Date.parse(reply) - t) / DAY));
    }
    if (e.status === "rejected" && e.closedAs === "no-response") ghosted++;
    if (!id.startsWith("manual:")) {
      const band = bands[e.snapshot.score >= 80 ? 0 : e.snapshot.score >= 65 ? 1 : 2] as Band;
      band.applied++;
      if (reply) band.replied++;
    }
  }
  waits.sort((a, b) => a - b);
  const w = (i: number) => waits[i] ?? 0;
  const mid = waits.length ? (waits.length % 2 ? w((waits.length - 1) / 2) : (w(waits.length / 2 - 1) + w(waits.length / 2)) / 2) : undefined;
  return {
    applied30,
    appliedThisWeek,
    applied,
    replied: answered,
    ghosted,
    ...(mid !== undefined ? { medianDaysToReply: Math.round(mid) } : {}),
    bands: bands.filter((b) => b.applied > 0),
  };
}

/** "40%", or "–" with nothing to divide. */
export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
