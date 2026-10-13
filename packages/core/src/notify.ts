import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Job } from "./schema";
import { rawjobsHome } from "./paths";
import { writeFileAtomic } from "./atomic";

/**
 * Telegram alerts: one short message per scan with how many new matches. The bot is the user's own (made with
 * @BotFather); its token and the chat id live in profile/secrets.json (gitignored, never in the
 * config) or, on a server, in TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.
 */
export const SECRETS_PATH = "profile/secrets.json";

export type TelegramSecrets = { token?: string; chatId?: string /** The bot's @name (not secret; shown in Settings). */; bot?: string };
type Secrets = { telegram?: TelegramSecrets };

function readSecrets(cwd = rawjobsHome()): Secrets {
  const path = resolve(cwd, SECRETS_PATH);
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Secrets) : {};
  } catch {
    return {};
  }
}

/** The bot token and chat id: environment first (servers), then profile/secrets.json. */
export function telegramSecrets(cwd = rawjobsHome()): TelegramSecrets {
  const saved = readSecrets(cwd).telegram ?? {};
  return { token: process.env.TELEGRAM_BOT_TOKEN || saved.token, chatId: process.env.TELEGRAM_CHAT_ID || saved.chatId, bot: saved.bot };
}

export function saveTelegramSecrets(patch: TelegramSecrets, cwd = rawjobsHome()): TelegramSecrets {
  const path = resolve(cwd, SECRETS_PATH);
  const all = readSecrets(cwd);
  const next = { ...all.telegram, ...patch };
  for (const k of Object.keys(next) as (keyof TelegramSecrets)[]) if (!next[k]) delete next[k];
  mkdirSync(dirname(path), { recursive: true });
  // The bot token: readable by this user only (modes are ignored on Windows).
  writeFileAtomic(path, `${JSON.stringify({ ...all, telegram: next }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return next;
}

/** "123456:ABC…xyz": enough to recognise it, not enough to use it. */
export const maskToken = (t?: string) => (t ? `${t.slice(0, t.indexOf(":") + 4)}…${t.slice(-3)}` : undefined);

const TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
export const looksLikeToken = (t: string) => TOKEN.test(t.trim());

type Fetch = typeof fetch;

async function call<T>(token: string, method: string, body: unknown, fetchImpl: Fetch = fetch): Promise<T> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) {
    if (res.status === 401) throw new Error("Telegram didn't accept that bot token. Copy it again from @BotFather.");
    if (res.status === 403) throw new Error("The bot can't message you yet. Open your bot in Telegram and press Start.");
    throw new Error(`Telegram said: ${json.description ?? `HTTP ${res.status}`}`);
  }
  return json.result as T;
}

/** The bot's own name, to check a token ("@my_jobs_bot"). */
export async function telegramBotName(token: string, fetchImpl?: Fetch): Promise<string> {
  const me = await call<{ username: string }>(token, "getMe", {}, fetchImpl);
  return `@${me.username}`;
}

/**
 * The chat to send to: the latest private chat that messaged the bot. The user sends the bot any
 * message first ("hi"); undefined until they have.
 */
export async function findTelegramChat(token: string, fetchImpl?: Fetch): Promise<{ chatId: string; name: string } | undefined> {
  const updates = await call<{ message?: { chat: { id: number; type: string; first_name?: string; username?: string } } }[]>(token, "getUpdates", { allowed_updates: ["message"] }, fetchImpl);
  const chat = updates
    .map((u) => u.message?.chat)
    .filter((c) => c?.type === "private")
    .at(-1);
  return chat ? { chatId: String(chat.id), name: chat.first_name ?? chat.username ?? "you" } : undefined;
}

export async function sendTelegram(text: string, secrets: TelegramSecrets, fetchImpl?: Fetch): Promise<void> {
  if (!secrets.token || !secrets.chatId) throw new Error("Telegram isn't set up yet: add your bot in Settings → Alerts.");
  await call(secrets.token, "sendMessage", { chat_id: secrets.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }, fetchImpl);
}

/** "<b>12</b> new jobs": the number in bold. */
const plural = (n: number, one: string, many: string) => `<b>${n.toLocaleString()}</b> ${n === 1 ? one : many}`;

/**
 * Every message has the same three parts, a blank line apart: a bold header naming what it's about,
 * the facts, then what to do (👉, in italics). No job lists, scores or links: the details are in the app.
 */
export const telegramMessage = (header: string, facts: string, action: string) => `${header}\n\n${facts}\n\n👉 <i>${action}</i>`;
const message = telegramMessage;

/** "12 new jobs · 3 strong fits" (never a 0: "no strong fits"). Undefined when nothing is new. */
function newJobsLine(jobs: readonly Job[], minScore: number): string | undefined {
  if (!jobs.length) return undefined;
  const strong = jobs.filter((j) => j.score >= minScore).length;
  return `${plural(jobs.length, "new job", "new jobs")} · ${strong ? plural(strong, "strong fit", "strong fits") : "no strong fits"}`;
}

const seeThem = (n: number) => `Open RawJobs on your computer to see ${n === 1 ? "it" : "them"}.`;

/** The connect confirmation: what the bot will send, and where to choose. */
export const connectedMessage = () =>
  message("🔔 <b>Connected</b>", "RawJobs will message you here when a scan finds new jobs or an update is ready.", "Choose which alerts you get in RawJobs settings.");

export const testMessage = () => message("👋 <b>Test alert</b>", "Alerts from RawJobs are working.", "Go back to RawJobs on your computer.");

/**
 * One message for a scan: how many new jobs and strong fits (with only_new off, `jobs` are every
 * strong fit, new or not). Undefined when there's nothing to say (no message beats an empty one).
 */
export function digest(jobs: readonly Job[], opts: { minScore: number; onlyNew?: boolean }): string | undefined {
  if (!jobs.length) return undefined;
  if (opts.onlyNew === false) return message("💼 <b>Strong fits</b>", plural(jobs.length, "strong fit", "strong fits"), seeThem(jobs.length));
  return message("💼 <b>New jobs</b>", newJobsLine(jobs, opts.minScore)!, seeThem(jobs.length));
}

/** The message for "tell me when this scan is done": always sent, finished or stopped, new jobs or not. */
export function finishedMessage(o: { newJobs: readonly Job[]; minScore: number; stopped?: boolean }): string {
  const facts = newJobsLine(o.newJobs, o.minScore);
  const n = o.newJobs.length;
  if (o.stopped)
    return message(
      "⏸ <b>Scan stopped</b>",
      facts ?? "No new jobs yet",
      n ? `Open RawJobs on your computer to see ${n === 1 ? "it" : "them"} and finish the scan.` : "Open RawJobs on your computer to finish the scan.",
    );
  return message("✅ <b>Scan finished</b>", facts ?? "No new jobs", n ? seeThem(n) : "Open RawJobs on your computer to see your matches.");
}
