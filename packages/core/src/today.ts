import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeFileAtomic } from "./atomic";
import { displayName } from "./display-name";
import { daysBetween, plusDays, type Task, type TaskEntry, tasksFor, today } from "./next-steps";
import { sendTelegram, type TelegramSecrets, telegramMessage } from "./notify";
import { readTracking } from "./tracking";

/**
 * "Today in your Pipeline": one Telegram message a morning with what's due, worked out with the same
 * tasks as the Pipeline's Next steps. It names jobs and companies only: never people, emails, phone
 * numbers, notes or what you wrote.
 */

type Fetch = typeof fetch;

/** One titled line, most urgent kinds first. */
export type TodayKind = "interview" | "offer" | "thank-you" | "overdue" | "follow-up";
export type TodayLine = { kind: TodayKind; title: string; company: string; time?: string; by?: "today" | "tomorrow"; days?: number };
/** Everything due today: the titled lines in order, and the jobs to apply to or close (counted, not named). */
export type TodaySummary = { lines: TodayLine[]; apply: number; close: number };

/** How many titled lines a message shows; the rest are counted. */
export const TODAY_MAX_LINES = 5;
/** Longer job titles are cut to this many characters, "…" included. */
export const TODAY_TITLE_MAX = 60;
/** A scheduled run after this local time (minutes after midnight) sends nothing: a morning message that late is no use. */
export const TODAY_CUTOFF = 12 * 60;

const ORDER: readonly TodayKind[] = ["interview", "offer", "thank-you", "overdue", "follow-up"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What's due on `now`'s local day, from the dashboard's tracking. Read loosely like the other reminders:
 * the dashboard owns that shape, and a job that can't be read is skipped.
 */
export function todaySummary(state: Record<string, unknown> | undefined, now = new Date()): TodaySummary {
  const day = today(now);
  const tomorrow = plusDays(day, 1);
  const lines: TodayLine[] = [];
  let apply = 0;
  let close = 0;
  for (const [id, v] of Object.entries(state ?? {})) {
    if (!isRecord(v)) continue;
    let tasks: Task[];
    try {
      tasks = tasksFor(id, v as TaskEntry, now);
    } catch {
      continue;
    }
    const snap = isRecord(v.snapshot) ? v.snapshot : {};
    const job = { title: typeof snap.title === "string" ? snap.title : "A job", company: typeof snap.company === "string" ? displayName(snap.company) : "" };
    for (const t of tasks) {
      if (t.kind === "interview" && t.due === day) lines.push({ kind: "interview", ...job, ...(t.time ? { time: t.time } : {}) });
      else if (t.kind === "deadline" && (t.due === day || t.due === tomorrow)) lines.push({ kind: "offer", ...job, by: t.due === day ? "today" : "tomorrow" });
      else if (t.kind === "thank-you" && t.due <= day) lines.push({ kind: "thank-you", ...job });
      else if (t.kind === "follow-up" && t.due <= day) {
        // On Saved the date means "Apply by": counted, not named.
        if (v.status === "saved") apply++;
        else if (t.due < day) lines.push({ kind: "overdue", ...job, days: daysBetween(t.due, day) });
        else lines.push({ kind: "follow-up", ...job });
      } else if (t.kind === "close") close++;
    }
  }
  // Most urgent first: by kind, then the earliest interview and the longest overdue.
  lines.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.time ?? "99").localeCompare(b.time ?? "99") || (b.days ?? 0) - (a.days ?? 0));
  return { lines, apply, close };
}

/** Text from the user's own data, safe inside Telegram's HTML. */
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A long title cut to TODAY_TITLE_MAX characters with "…". */
export const cutTitle = (s: string) => {
  const t = s.trim();
  return t.length > TODAY_TITLE_MAX ? `${t.slice(0, TODAY_TITLE_MAX - 1).trimEnd()}…` : t;
};

/** One titled line ("⏰ Follow up: Head of Product · Acme (2 days overdue)"); `html` false for the terminal. */
export function todayLine(l: TodayLine, html = true): string {
  const plain = l.company ? `${cutTitle(l.title)} · ${l.company}` : cutTitle(l.title);
  const job = html ? escapeHtml(plain) : plain;
  if (l.kind === "interview") return `📅 Interview: ${job}${l.time ? ` (${l.time})` : ""}`;
  if (l.kind === "offer") return `⏳ Answer the offer: ${job} (by ${l.by})`;
  if (l.kind === "thank-you") return `✉️ Thank-you: ${job}`;
  if (l.kind === "overdue") return `⏰ Follow up: ${job} (${l.days} ${l.days === 1 ? "day" : "days"} overdue)`;
  return `⏰ Follow up: ${job}`;
}

const count = (n: number, one: string, many: string, plus = false) => `<b>${plus ? "+" : ""}${n.toLocaleString()}</b> ${n === 1 ? one : many}`;

export const TODAY_HEADER = "☀️ <b>Today in your Pipeline</b>";
const ACTION = "Open the Pipeline in RawJobs on your computer.";

/** The message's middle part: up to TODAY_MAX_LINES titled lines, then one line counting the rest. Undefined when nothing is due. */
function todayFacts(s: TodaySummary): string | undefined {
  const shown = s.lines.slice(0, TODAY_MAX_LINES);
  const rest = s.lines.slice(TODAY_MAX_LINES);
  const moreFollowUps = rest.filter((l) => l.kind === "overdue" || l.kind === "follow-up").length;
  const moreOther = rest.length - moreFollowUps;
  const counts = [
    moreFollowUps && count(moreFollowUps, "more follow-up", "more follow-ups", true),
    s.apply && count(s.apply, "job to apply to", "jobs to apply to"),
    s.close && count(s.close, "job ready to close", "jobs ready to close"),
    moreOther && count(moreOther, "more task", "more tasks", true),
  ].filter(Boolean);
  const parts = [shown.map((l) => todayLine(l)).join("\n"), counts.join(" · ")].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** The daily message, or undefined when nothing is due (no message beats an empty one). */
export function todayMessage(s: TodaySummary): string | undefined {
  const facts = todayFacts(s);
  return facts ? telegramMessage(TODAY_HEADER, facts, ACTION) : undefined;
}

/** "Send a test now": today's real message marked as a test, or a note on when it will come when nothing is due. */
export function todayTestMessage(s: TodaySummary, time: string): string {
  const facts = todayFacts(s);
  if (facts) return telegramMessage(TODAY_HEADER, `This is a test.\n\n${facts}`, ACTION);
  return telegramMessage(TODAY_HEADER, `This is a test. Your daily summary will arrive at ${time} when something is due.`, "Change it in RawJobs → Settings → Notifications.");
}

/** The last day the summary ran: when, and whether it sent or found nothing due. A sent day isn't sent again. */
export const DAILY_SENT = "daily-summary-sent.json";
export type DailySent = { day: string; at: string; result: "sent" | "nothing-due" };

export function readDailySent(dataDir: string): DailySent | undefined {
  const path = resolve(dataDir, DAILY_SENT);
  try {
    if (!existsSync(path)) return undefined;
    const j = JSON.parse(readFileSync(path, "utf8")) as Partial<DailySent>;
    return typeof j.day === "string" && typeof j.at === "string" && (j.result === "sent" || j.result === "nothing-due") ? (j as DailySent) : undefined;
  } catch {
    return undefined;
  }
}

export type DailyResult = "sent" | "nothing-due" | "already-sent" | "too-late" | "off" | `failed: ${string}`;

/**
 * Send today's summary once a day. `scheduled`: the run the computer's scheduler started, which sends
 * nothing after TODAY_CUTOFF (a run missed while the computer was off and caught up in the afternoon).
 * Never throws: says what happened.
 */
export async function sendDailySummary(dataDir: string, secrets: TelegramSecrets, opts: { home?: string; now?: Date; fetchImpl?: Fetch; scheduled?: boolean } = {}): Promise<DailyResult> {
  if (!secrets.token || !secrets.chatId) return "off";
  const now = opts.now ?? new Date();
  if (opts.scheduled && now.getHours() * 60 + now.getMinutes() > TODAY_CUTOFF) return "too-late";
  const day = today(now);
  const last = readDailySent(dataDir);
  if (last?.day === day && last.result === "sent") return "already-sent";
  const text = todayMessage(todaySummary(readTracking(opts.home)?.state, now));
  const record = (result: DailySent["result"]) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileAtomic(resolve(dataDir, DAILY_SENT), JSON.stringify({ day, at: now.toISOString(), result } satisfies DailySent));
  };
  if (!text) {
    record("nothing-due");
    return "nothing-due";
  }
  try {
    await sendTelegram(text, secrets, opts.fetchImpl);
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
  record("sent");
  return "sent";
}

/** Send the test message now, whatever the time and whether today's was sent. Never throws. */
export async function sendDailyTest(secrets: TelegramSecrets, time: string, opts: { home?: string; now?: Date; fetchImpl?: Fetch } = {}): Promise<"sent" | "off" | `failed: ${string}`> {
  if (!secrets.token || !secrets.chatId) return "off";
  try {
    await sendTelegram(todayTestMessage(todaySummary(readTracking(opts.home)?.state, opts.now), time), secrets, opts.fetchImpl);
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}
