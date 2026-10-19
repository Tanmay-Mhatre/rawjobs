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
