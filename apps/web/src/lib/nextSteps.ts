import { daysBetween, lastReceived, type Task } from "@rawjobs/core/next-steps";
import { type Activity, type Channel, type Entry, QUIET_DAYS, STATUS_LABEL, stageSince, today } from "./userState";

/**
 * What to do next on each tracked job lives in @rawjobs/core/next-steps, so the Pipeline and the daily
 * Telegram summary count the same tasks. This file adds the board's own parts: card tones and last activity.
 */
export { closeSuggestion, groupTasks, MAX_FOLLOW_UPS, nextSteps, type Task, type TaskKind, tasksFor, WEEK_DAYS } from "@rawjobs/core/next-steps";

const DAY = 864e5;

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
  // Applied, no reply for QUIET_DAYS, and no follow-up date still ahead: "No reply · Nd".
  if (e.status === "applied" && !(e.followUp && e.followUp > day)) {
    const since = Math.max(Date.parse(stageSince(e)), lastReceived(e));
    const days = Math.floor((now.getTime() - since) / DAY);
    if (days >= QUIET_DAYS) return { tone: "quiet", task, days };
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
