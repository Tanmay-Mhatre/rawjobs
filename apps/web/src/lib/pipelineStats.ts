import type { WeeklyPlan } from "./prefs";
import { type Activity, type Entry, type Status, dayAfter, stageSince, today, type UserState } from "./userState";

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

/** The job is, or once was, at one of these stages. */
const reached = (e: Entry, ...s: Status[]) => s.includes(e.status as Status) || (e.history ?? []).some((x) => s.includes(x.status as Status));
/** The company answered: a step that means a reply, or a message back. */
const heardBack = (e: Entry) =>
  replied(e, e.status ?? null) ||
  (e.history ?? []).some((x) => replied(e, x.status)) ||
  (e.activities ?? []).some((a) => a.dir === "received" && a.channel !== "note") ||
  (e.interviews ?? []).length > 0 ||
  Boolean(e.offer);

/** Sent touches that count as outreach when they aren't follow-ups (not notes or in-person meetings). */
const OUTREACH: Activity["channel"][] = ["email", "linkedin", "whatsapp", "call", "referral"];

/** Monday 00:00 local time of `now`'s week. */
export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** `d` moved by `days` days, local time (safe across clock changes). */
const plusDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

export type WeekBar = { start: Date; applied: number };

export type Funnel = { applied: number; heardBack: number; interviewed: number; offer: number; noResponse: number };

export type PipelineStats = {
  /** Monday and Sunday of this week, local time. */
  week: { start: Date; end: Date };
  /** Applications this week. */
  applied: number;
  /** Touches sent this week from a follow-up or thank-you task. */
  followUps: number;
  /** Other touches sent this week: email, LinkedIn, WhatsApp, call or referral. */
  outreach: number;
  /** Interviews dated this week. */
  interviewsThisWeek: number;
  /** Interviews from today on, on jobs that are still open, and the first of them. */
  upcoming: number;
  next?: { on: string; time?: string };
  /** Applications per week, oldest first; the last is this week. */
  weeks: WeekBar[];
  /** Weeks in a row the applications plan was met. This week adds once met and never breaks the run. */
  streak: number;
  /** Applications in the last 30 days and what became of them. */
  funnel: Funnel;
  /** Ever applied to. */
  everApplied: number;
};

/** The funnel shows from this many applications in 30 days. */
export const FUNNEL_MIN = 5;
/** The streak shows from this many weeks. */
export const STREAK_MIN = 2;
/** How far back a streak is counted. */
const STREAK_WEEKS = 104;

/** This week's activity against your plan, the last `weeksBack` weeks, and where the last 30 days of applications went. */
export function pipelineStats(state: UserState, plan: WeeklyPlan = {}, now = new Date(), weeksBack = 8): PipelineStats {
  const monday = weekStart(now);
  const nextMonday = plusDays(monday, 7).getTime();
  const span = Math.max(weeksBack, STREAK_WEEKS);
  const starts = Array.from({ length: span }, (_, i) => plusDays(monday, (i - span + 1) * 7).getTime());
  const perWeek = new Array<number>(span).fill(0);
  const weekOf = (t: number) => {
    if (!(t < nextMonday) || t < (starts[0] as number)) return -1;
    let i = span - 1;
    while (i > 0 && t < (starts[i] as number)) i--;
    return i;
  };
  const inWeek = (iso: string) => {
    const t = Date.parse(iso);
    return t >= monday.getTime() && t < nextMonday;
  };
  const day = today(now);
  const firstDay = dayAfter(monday.toISOString(), 0);
  const lastDay = dayAfter(`${firstDay}T12:00:00`, 6);
  const funnel: Funnel = { applied: 0, heardBack: 0, interviewed: 0, offer: 0, noResponse: 0 };
  let followUps = 0;
  let outreach = 0;
  let interviewsThisWeek = 0;
  let upcoming = 0;
  let everApplied = 0;
  let next: PipelineStats["next"];
  for (const e of Object.values(state)) {
    const at = appliedAt(e);
    if (at) {
      everApplied++;
      const t = Date.parse(at);
      const w = weekOf(t);
      if (w >= 0) perWeek[w] = (perWeek[w] ?? 0) + 1;
      if (now.getTime() - t <= 30 * DAY) {
        funnel.applied++;
        const heard = heardBack(e);
        if (heard) funnel.heardBack++;
        if (reached(e, "interviewing", "offer") || (e.interviews ?? []).length > 0) funnel.interviewed++;
        if (reached(e, "offer") || e.offer) funnel.offer++;
        if (!heard && e.status === "rejected" && e.closedAs === "no-response") funnel.noResponse++;
      }
    }
    for (const a of e.activities ?? []) {
      if (a.dir !== "sent" || a.channel === "note" || !inWeek(a.at)) continue;
      if (a.followUp) followUps++;
      else if (OUTREACH.includes(a.channel)) outreach++;
    }
    const open = e.status !== "rejected" && e.status !== "dismissed";
    for (const iv of e.interviews ?? []) {
      if (iv.on >= firstDay && iv.on <= lastDay) interviewsThisWeek++;
      if (!open || iv.on < day) continue;
      upcoming++;
      if (!next || iv.on < next.on || (iv.on === next.on && (iv.time ?? "99") < (next.time ?? "99"))) next = { on: iv.on, ...(iv.time ? { time: iv.time } : {}) };
    }
  }
  const goal = plan.applications;
  let streak = 0;
  if (goal) {
    if ((perWeek[span - 1] as number) >= goal) streak++;
    for (let i = span - 2; i >= 0 && (perWeek[i] as number) >= goal; i--) streak++;
  }
  return {
    week: { start: monday, end: plusDays(monday, 6) },
    applied: perWeek[span - 1] as number,
    followUps,
    outreach,
    interviewsThisWeek,
    upcoming,
    ...(next ? { next } : {}),
    weeks: starts.slice(span - weeksBack).map((s, i) => ({ start: new Date(s), applied: perWeek[span - weeksBack + i] as number })),
    streak,
    funnel,
    everApplied,
  };
}

/** "40%", or "–" with nothing to divide. */
export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
