/**
 * What to do next on each tracked job, worked out from its entry (never stored): its follow-up date,
 * interviews, offer deadline and touches. Only the follow-up date and the tasks you marked done
 * (`entry.skipped`) are stored. Shared by the Pipeline's Next steps and the daily Telegram summary,
 * so both always count the same tasks.
 */

export const PIPELINE = ["saved", "applied", "interviewing", "offer", "rejected"] as const;
export type PipelineStatus = (typeof PIPELINE)[number];
export type Status = PipelineStatus | "dismissed";

export const STATUS_LABEL: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Closed",
  dismissed: "Not interested",
};

/** Days applied with no reply after which RawJobs suggests closing it as No response (likely ghosted). */
export const QUIET_DAYS = 21;

/** Stages with a next step: a follow-up date is kept in each. */
export const ACTIVE: readonly Status[] = ["saved", "applied", "interviewing", "offer"];
export const isActive = (s: Status | undefined) => !!s && ACTIVE.includes(s);

/** "2026-10-22": a date `days` after `iso`, in local time. For a YYYY-MM-DD day, pass `${day}T12:00:00`. */
export function dayAfter(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD, in local time. */
export const today = (now = new Date()) => dayAfter(now.toISOString(), 0);

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The parts of a tracked job the tasks are worked out from. The dashboard's Entry has these and more. */
export type TaskEntry = {
  status?: Status;
  history?: { status: Status | null; at: string }[];
  updatedAt: string;
  followUp?: string;
  interviews?: { on: string; what: string; time?: string; contactId?: string }[];
  activities?: { at: string; channel: string; dir?: "sent" | "received"; contactId?: string; followUp?: true }[];
  skipped?: string[];
  offer?: { deadline?: string };
};
type Touch = NonNullable<TaskEntry["activities"]>[number];

/** When the job reached its current status: the last history step there, else its last change. */
export function stageSince(e: Pick<TaskEntry, "status" | "history" | "updatedAt">): string {
  const h = e.history?.findLast((x) => x.status === e.status);
  return h?.at ?? e.updatedAt;
}

export type TaskKind = "follow-up" | "thank-you" | "interview" | "deadline" | "close";
export type Task = {
  /** "follow-up:2026-10-22": marking it done stores this, so a new date brings the task back. */
  key: string;
  /** The job. */
  id: string;
  kind: TaskKind;
  /** YYYY-MM-DD, local. */
  due: string;
  label: string;
  why: string;
  contactId?: string;
  /** An interview's time (HH:MM), when you entered one. */
  time?: string;
};

/** After this many sent follow-ups with no reply, RawJobs suggests closing the job as No response. */
export const MAX_FOLLOW_UPS = 2;
/** A thank-you is suggested for an interview up to this many days ago. */
const THANK_YOU_DAYS = 14;
/** "This week" in Next steps: due up to this many days ahead. */
export const WEEK_DAYS = 7;

const DAY = 864e5;
/** A YYYY-MM-DD day `n` days on, worked out at noon so DST never moves it. */
export const plusDays = (day: string, n: number) => dayAfter(`${day}T12:00:00`, n);
/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / DAY);
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const isTouch = (a: Touch) => a.channel !== "note" && !!a.dir;
/** The newest received touch's time (ms), or 0. */
export const lastReceived = (e: Pick<TaskEntry, "activities">) => Math.max(0, ...(e.activities ?? []).filter((a) => isTouch(a) && a.dir === "received").map((a) => Date.parse(a.at)));
const lastSent = (e: TaskEntry) => (e.activities ?? []).filter((a) => isTouch(a) && a.dir === "sent").at(-1);

/** HH:MM of an ISO time, local. */
const localTime = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** A touch sent after the interview: a later local day, or the same day after its time when it has one. */
const afterInterview = (at: string, i: { on: string; time?: string }) => {
  const day = dayAfter(at, 0);
  return day > i.on || (day === i.on && !!i.time && localTime(at) > i.time);
};

/** The tasks for one job, soonest first; done ones (in `skipped`) left out. */
export function tasksFor(id: string, e: TaskEntry, now = new Date()): Task[] {
  if (!isActive(e.status)) return [];
  const day = today(now);
  const week = plusDays(day, WEEK_DAYS);
  const tasks: Task[] = [];
  const sent = lastSent(e);

  if (e.followUp && isDay(e.followUp)) {
    const saved = e.status === "saved";
    tasks.push({
      key: `follow-up:${e.followUp}`,
      id,
      kind: "follow-up",
      due: e.followUp,
      label: saved ? "Apply by" : "Follow up",
      why: saved ? "Saved to apply" : sent ? `You last wrote on ${shortDay(dayAfter(sent.at, 0))}` : `${STATUS_LABEL[e.status!]} since ${shortDay(dayAfter(stageSince(e), 0))}`,
      ...(sent?.contactId ? { contactId: sent.contactId } : {}),
    });
  }

  const interviews = (e.interviews ?? []).filter((i) => isDay(i.on));
  // A thank-you after the latest interview that has passed, until you send a touch after it.
  const passed = interviews
    .filter((i) => i.on < day && i.on >= plusDays(day, -THANK_YOU_DAYS))
    .sort((a, b) => a.on.localeCompare(b.on))
    .at(-1);
  if (passed && !(e.activities ?? []).some((a) => isTouch(a) && a.dir === "sent" && afterInterview(a.at, passed))) {
    tasks.push({
      key: `thank-you:${passed.on}`,
      id,
      kind: "thank-you",
      due: plusDays(passed.on, 1),
      label: "Send a thank-you",
      why: `After your ${passed.what} interview on ${shortDay(passed.on)}`,
      ...(passed.contactId ? { contactId: passed.contactId } : {}),
    });
  }
  for (const i of interviews) {
    if (i.on < day || i.on > week) continue;
    tasks.push({
      key: `interview:${i.on}`,
      id,
      kind: "interview",
      due: i.on,
      label: /interview/i.test(i.what) ? i.what : `${i.what} interview`,
      why: i.time ? `At ${i.time}` : shortDay(i.on),
      ...(i.contactId ? { contactId: i.contactId } : {}),
      ...(i.time ? { time: i.time } : {}),
    });
  }

  const deadline = e.offer?.deadline;
  if (e.status === "offer" && isDay(deadline) && deadline >= day && deadline <= week) {
    tasks.push({ key: `deadline:${deadline}`, id, kind: "deadline", due: deadline, label: "Answer the offer", why: `Answer by ${shortDay(deadline)}` });
  }

  const close = closeSuggestion(e, now);
  if (close) {
    tasks.push({
      key: `close:${close.followUps}`,
      id,
      kind: "close",
      due: day,
      label: "Close as no response?",
      why: close.followUps >= MAX_FOLLOW_UPS ? `${close.followUps} follow-ups with no reply` : `No reply in ${close.days} days`,
    });
  }

  const skipped = new Set(e.skipped ?? []);
  return tasks.filter((t) => !skipped.has(t.key)).sort((a, b) => a.due.localeCompare(b.due));
}

/**
 * Applied, and either MAX_FOLLOW_UPS sent follow-ups with no reply since, or QUIET_DAYS with no
 * reply. A follow-up date still ahead (you just chased it, or chose "Follow up once more") waits for it.
 */
export function closeSuggestion(e: TaskEntry, now = new Date()): { followUps: number; days: number } | undefined {
  if (e.status !== "applied" || (e.followUp && e.followUp > today(now))) return undefined;
  const since = Math.max(Date.parse(stageSince(e)), lastReceived(e));
  const followUps = (e.activities ?? []).filter((a) => a.followUp && a.dir === "sent" && Date.parse(a.at) > since).length;
  const days = Math.floor((now.getTime() - since) / DAY);
  return followUps >= MAX_FOLLOW_UPS || days >= QUIET_DAYS ? { followUps, days } : undefined;
}

/** Every tracked job's tasks, by job id (only jobs with any). Run once per state change or hour. */
export function nextSteps(state: Readonly<Record<string, TaskEntry>>, now = new Date()): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const [id, e] of Object.entries(state)) {
    const tasks = tasksFor(id, e, now);
    if (tasks.length) out.set(id, tasks);
  }
  return out;
}

/** Next steps' groups: Overdue (before today), Today, and This week (to WEEK_DAYS ahead); later ones are left out. */
export function groupTasks(byJob: Map<string, Task[]>, now = new Date()): { overdue: Task[]; today: Task[]; week: Task[] } {
  const day = today(now);
  const week = plusDays(day, WEEK_DAYS);
  const all = [...byJob.values()].flat().sort((a, b) => a.due.localeCompare(b.due));
  return { overdue: all.filter((t) => t.due < day), today: all.filter((t) => t.due === day), week: all.filter((t) => t.due > day && t.due <= week) };
}
