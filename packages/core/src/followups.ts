import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sendTelegram, type TelegramSecrets, telegramMessage } from "./notify";
import { readTracking } from "./tracking";

type Fetch = typeof fetch;
/** The count in bold, as every alert writes it. */
const plural = (n: number, one: string, many: string) => `<b>${n.toLocaleString()}</b> ${n === 1 ? one : many}`;

/** Which follow-ups were already sent (job id -> its follow-up date), so each is sent once. */
export const FOLLOW_UPS_SENT = "followups-sent.json";

/**
 * Jobs you applied to whose follow-up date (YYYY-MM-DD) is `today` or past, from the dashboard's
 * tracking. Read loosely: the dashboard owns that shape, and anything unexpected is skipped.
 */
export function dueFollowUps(state: Record<string, unknown> | undefined, today: string): { id: string; followUp: string }[] {
  const due: { id: string; followUp: string }[] = [];
  for (const [id, v] of Object.entries(state ?? {})) {
    const e = v as { status?: unknown; followUp?: unknown } | null;
    if (e?.status === "applied" && typeof e.followUp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.followUp) && e.followUp <= today) due.push({ id, followUp: e.followUp });
  }
  return due;
}

/** "2 jobs you applied to are due a follow-up": no titles, as every alert keeps the details in the app. */
export const followUpMessage = (n: number) =>
  telegramMessage("⏰ <b>Time to follow up</b>", `${plural(n, "job", "jobs")} you applied to ${n === 1 ? "is" : "are"} due a follow-up.`, "Open the Pipeline in RawJobs.");

/** Today as YYYY-MM-DD in local time, the way the dashboard writes follow-up dates. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Send one Telegram message for follow-ups that came due since the last one. A job is sent again only
 * when you move its date. Never throws: says what happened.
 */
export async function remindFollowUps(dataDir: string, secrets: TelegramSecrets, opts: { home?: string; now?: Date; fetchImpl?: Fetch } = {}): Promise<"sent" | "nothing-due" | `failed: ${string}`> {
  const due = dueFollowUps(readTracking(opts.home)?.state, localDay(opts.now ?? new Date()));
  const path = resolve(dataDir, FOLLOW_UPS_SENT);
  let sent: Record<string, string> = {};
  try {
    if (existsSync(path)) sent = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    sent = {};
  }
  const fresh = due.filter((d) => sent[d.id] !== d.followUp);
  if (!fresh.length) return "nothing-due";
  try {
    await sendTelegram(followUpMessage(fresh.length), secrets, opts.fetchImpl);
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
  // Only what's still due is kept, so the file never grows past your open applications.
  writeFileSync(path, JSON.stringify(Object.fromEntries(due.map((d) => [d.id, d.followUp]))));
  return "sent";
}

/** Which interview reminders were already sent ("<job id> <day>"), so each is sent once. */
export const INTERVIEWS_SENT = "interviews-sent.json";

/** Interviews (from the dashboard's tracking) on `today` or `tomorrow`, read loosely like follow-ups. */
export function dueInterviews(state: Record<string, unknown> | undefined, today: string, tomorrow: string): string[] {
  const keys: string[] = [];
  for (const [id, v] of Object.entries(state ?? {})) {
    const list = (v as { interviews?: unknown } | null)?.interviews;
    if (!Array.isArray(list)) continue;
    for (const i of list as { on?: unknown }[]) if (i?.on === today || i?.on === tomorrow) keys.push(`${id} ${i.on}`);
  }
  return keys;
}

/** "1 interview today or tomorrow": no company names, as every alert keeps the details in the app. */
export const interviewMessage = (n: number) => telegramMessage("📅 <b>Interview coming up</b>", `${plural(n, "interview", "interviews")} today or tomorrow.`, "See it in the Pipeline in RawJobs.");

/** Send one Telegram message for interviews today or tomorrow not reminded yet. Never throws. */
export async function remindInterviews(dataDir: string, secrets: TelegramSecrets, opts: { home?: string; now?: Date; fetchImpl?: Fetch } = {}): Promise<"sent" | "nothing-due" | `failed: ${string}`> {
  const now = opts.now ?? new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const due = dueInterviews(readTracking(opts.home)?.state, localDay(now), localDay(tomorrow));
  const path = resolve(dataDir, INTERVIEWS_SENT);
  let sent: string[] = [];
  try {
    if (existsSync(path)) sent = JSON.parse(readFileSync(path, "utf8")) as string[];
  } catch {
    sent = [];
  }
  const fresh = due.filter((k) => !sent.includes(k));
  if (!fresh.length) return "nothing-due";
  try {
    await sendTelegram(interviewMessage(fresh.length), secrets, opts.fetchImpl);
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
  // Only what's still coming up is kept, so the file stays tiny.
  writeFileSync(path, JSON.stringify(due));
  return "sent";
}

/** Which week's summary was sent last ("2026-10-19", that week's Monday), so it's sent once a week. */
export const WEEKLY_SENT = "weekly-summary-sent.json";

type Step = { status?: unknown; at?: unknown };

/** Last week's applications and replies (interview, offer, or a rejection), from each job's dated steps. */
export function lastWeek(state: Record<string, unknown> | undefined, from: number, to: number): { applied: number; replies: number } {
  let applied = 0;
  let replies = 0;
  for (const v of Object.values(state ?? {})) {
    const e = v as { history?: unknown; closedAs?: unknown } | null;
    if (!Array.isArray(e?.history)) continue;
    for (const h of e.history as Step[]) {
      const t = typeof h?.at === "string" ? Date.parse(h.at) : Number.NaN;
      if (!(t >= from && t < to)) continue;
      if (h.status === "applied") applied++;
      else if (h.status === "interviewing" || h.status === "offer" || (h.status === "rejected" && e?.closedAs === "rejected")) replies++;
    }
  }
  return { applied, replies };
}

/** "Last week: 4 applications (goal 5), 1 reply." */
export const weeklyMessage = (w: { applied: number; replies: number }, goal?: number) =>
  telegramMessage(
    "📊 <b>Your week</b>",
    `${plural(w.applied, "application", "applications")}${goal ? ` (goal ${goal})` : ""}, ${plural(w.replies, "reply", "replies")}.`,
    "See your insights in the Pipeline in RawJobs.",
  );

/** Once a week, with the first scan from Monday: last week's applications and replies. Never throws. */
export async function sendWeeklySummary(
  dataDir: string,
  secrets: TelegramSecrets,
  opts: { home?: string; now?: Date; fetchImpl?: Fetch } = {},
): Promise<"sent" | "not-yet" | "nothing" | `failed: ${string}`> {
  const now = opts.now ?? new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = localDay(monday);
  const path = resolve(dataDir, WEEKLY_SENT);
  try {
    if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")) === week) return "not-yet";
  } catch {
    // A broken file: send, then write it fresh.
  }
  const tracking = readTracking(opts.home);
  const prev = new Date(monday);
  prev.setDate(prev.getDate() - 7);
  const w = lastWeek(tracking?.state, prev.getTime(), monday.getTime());
  // Nothing tracked last week: no message, and don't check again until next week.
  if (!w.applied && !w.replies) {
    writeFileSync(path, JSON.stringify(week));
    return "nothing";
  }
  const goal = (tracking?.prefs as { weeklyGoal?: unknown } | undefined)?.weeklyGoal;
  try {
    await sendTelegram(weeklyMessage(w, typeof goal === "number" ? goal : undefined), secrets, opts.fetchImpl);
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
  writeFileSync(path, JSON.stringify(week));
  return "sent";
}

/** Which offer-deadline reminders were already sent ("<job id> <day>"). */
export const DEADLINES_SENT = "offer-deadlines-sent.json";

/** Offers whose answer-by date is today or tomorrow, still at Offer. */
export function dueDeadlines(state: Record<string, unknown> | undefined, today: string, tomorrow: string): string[] {
  const keys: string[] = [];
  for (const [id, v] of Object.entries(state ?? {})) {
    const e = v as { status?: unknown; offer?: { deadline?: unknown } } | null;
    const d = e?.offer?.deadline;
    if (e?.status === "offer" && (d === today || d === tomorrow)) keys.push(`${id} ${d}`);
  }
  return keys;
}

export const deadlineMessage = (n: number) =>
  telegramMessage("⏳ <b>Offer deadline</b>", `${plural(n, "offer needs", "offers need")} an answer today or tomorrow.`, "Compare them in the Pipeline in RawJobs.");

/** One Telegram message for offer deadlines today or tomorrow, each sent once. Never throws. */
export async function remindDeadlines(dataDir: string, secrets: TelegramSecrets, opts: { home?: string; now?: Date; fetchImpl?: Fetch } = {}): Promise<"sent" | "nothing-due" | `failed: ${string}`> {
  const now = opts.now ?? new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const due = dueDeadlines(readTracking(opts.home)?.state, localDay(now), localDay(tomorrow));
  const path = resolve(dataDir, DEADLINES_SENT);
  let sent: string[] = [];
  try {
    if (existsSync(path)) sent = JSON.parse(readFileSync(path, "utf8")) as string[];
  } catch {
    sent = [];
  }
  const fresh = due.filter((k) => !sent.includes(k));
  if (!fresh.length) return "nothing-due";
  try {
    await sendTelegram(deadlineMessage(fresh.length), secrets, opts.fetchImpl);
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
  writeFileSync(path, JSON.stringify(due));
  return "sent";
}
