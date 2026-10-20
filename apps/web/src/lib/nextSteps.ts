import { type Activity, type Channel, dayAfter, type Entry, FOLLOW_UP_DAYS, isActive, isDay, QUIET_DAYS, STATUS_LABEL, stageSince, today, type UserState } from "./userState";

/**
 * What to do next on each tracked job, worked out from its entry (never stored): its follow-up date,
 * interviews, offer deadline and touches. Only the follow-up date and the tasks you marked done
 * (`entry.skipped`) are stored.
 */
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
};

/** After this many sent follow-ups with no reply, RawJobs suggests closing the job as No response. */
export const MAX_FOLLOW_UPS = 2;
/** A thank-you is suggested for an interview up to this many days ago. */
const THANK_YOU_DAYS = 14;
/** "This week" in Next steps: due up to this many days ahead. */
export const WEEK_DAYS = 7;

const DAY = 864e5;
/** A YYYY-MM-DD day `n` days on, worked out at noon so DST never moves it. */
const plusDays = (day: string, n: number) => dayAfter(`${day}T12:00:00`, n);
/** Whole days from `a` to `b` (both YYYY-MM-DD). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / DAY);
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const isTouch = (a: Activity) => a.channel !== "note" && !!a.dir;
/** The newest received touch's time (ms), or 0. */
const lastReceived = (e: Entry) => Math.max(0, ...(e.activities ?? []).filter((a) => isTouch(a) && a.dir === "received").map((a) => Date.parse(a.at)));
const lastSent = (e: Entry) => (e.activities ?? []).filter((a) => isTouch(a) && a.dir === "sent").at(-1);

/** The tasks for one job, soonest first; done ones (in `skipped`) left out. */
export function tasksFor(id: string, e: Entry, now = new Date()): Task[] {
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
  // A thank-you after the latest interview that has passed, until you send any touch from that day on.
  const passed = interviews
    .filter((i) => i.on < day && i.on >= plusDays(day, -THANK_YOU_DAYS))
    .sort((a, b) => a.on.localeCompare(b.on))
    .at(-1);
  if (passed && !(e.activities ?? []).some((a) => isTouch(a) && a.dir === "sent" && dayAfter(a.at, 0) >= passed.on)) {
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
export function closeSuggestion(e: Entry, now = new Date()): { followUps: number; days: number } | undefined {
  if (e.status !== "applied" || (e.followUp && e.followUp > today(now))) return undefined;
  const since = Math.max(Date.parse(stageSince(e)), lastReceived(e));
  const followUps = (e.activities ?? []).filter((a) => a.followUp && a.dir === "sent" && Date.parse(a.at) > since).length;
  const days = Math.floor((now.getTime() - since) / DAY);
  return followUps >= MAX_FOLLOW_UPS || days >= QUIET_DAYS ? { followUps, days } : undefined;
}

/** Every tracked job's tasks, by job id (only jobs with any). Run once per state change or hour. */
export function nextSteps(state: UserState, now = new Date()): Map<string, Task[]> {
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

/**
 * The card's dot and chip. Tones: overdue = danger, today and quiet = warning, later = neutral,
 * none = dashed. `days` is how overdue (overdue) or how long without a reply (quiet).
 */
export type CardTone = "overdue" | "today" | "quiet" | "later" | "none" | "closed";
export type CardState = { tone: CardTone; task?: Task; days?: number };

export function cardState(e: Entry, tasks: readonly Task[] = [], now = new Date()): CardState {
  if (e.status === "rejected" || e.status === "dismissed") return { tone: "closed" };
  const day = today(now);
  const task = tasks[0];
  if (task && task.due < day) return { tone: "overdue", task, days: daysBetween(task.due, day) };
  if (task && task.due === day) return { tone: "today", task };
  // Applied, and no reply for a week or more: "No reply · Nd".
  if (e.status === "applied") {
    const since = Math.max(Date.parse(stageSince(e)), lastReceived(e));
    const days = Math.floor((now.getTime() - since) / DAY);
    if (days >= FOLLOW_UP_DAYS) return { tone: "quiet", task, days };
  }
  return task ? { tone: "later", task } : { tone: "none" };
}

/** What happened last on a job, in a few words ("Messaged Priya on LinkedIn", "Moved to Interviewing"). */
export type LastActivity = { at: string; channel?: Channel; text: string };

const SENT: Record<Channel, (who?: string) => string> = {
  email: (w) => (w ? `Emailed ${w}` : "Sent an email"),
  linkedin: (w) => (w ? `Messaged ${w} on LinkedIn` : "Sent a LinkedIn message"),
  whatsapp: (w) => (w ? `Messaged ${w} on WhatsApp` : "Sent a WhatsApp message"),
  call: (w) => (w ? `Called ${w}` : "Made a call"),
  meeting: (w) => (w ? `Met ${w}` : "Met in person"),
  referral: (w) => (w ? `Asked ${w} for a referral` : "Asked for a referral"),
  note: () => "Added a note",
};
const RECEIVED: Record<Channel, (who?: string) => string> = {
  email: (w) => (w ? `Email from ${w}` : "Got an email"),
  linkedin: (w) => (w ? `LinkedIn message from ${w}` : "Got a LinkedIn message"),
  whatsapp: (w) => (w ? `WhatsApp from ${w}` : "Got a WhatsApp message"),
  call: (w) => (w ? `Call from ${w}` : "Got a call"),
  meeting: (w) => (w ? `Met ${w}` : "Met in person"),
  referral: (w) => (w ? `Referred by ${w}` : "Got a referral"),
  note: () => "Added a note",
};

/** The touch in a few words, with the person's name when they're still on the job. */
export function activityText(e: Pick<Entry, "contacts">, a: Activity): string {
  const who = a.contactId ? e.contacts?.find((c) => c.id === a.contactId)?.name : undefined;
  return (a.dir === "received" ? RECEIVED : SENT)[a.channel](who);
}

/** The newest of the job's touches and stage changes. */
export function lastActivity(e: Entry): LastActivity | undefined {
  const a = (e.activities ?? []).reduce<Activity | undefined>((m, x) => (!m || Date.parse(x.at) >= Date.parse(m.at) ? x : m), undefined);
  const h = e.history?.at(-1);
  if (a && (!h || Date.parse(a.at) >= Date.parse(h.at))) return { at: a.at, channel: a.channel, text: activityText(e, a) };
  if (h) return { at: h.at, text: h.status ? `Moved to ${STATUS_LABEL[h.status]}` : "Taken off the board" };
  return undefined;
}
