import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Job } from "./schema";
import { rankScore } from "./score";
import { rawjobsHome } from "./paths";
import { writeFileAtomic } from "./atomic";

/**
 * Telegram alerts: one message per scan with the new matches. The bot is the user's own (made with
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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MAX_LINES = 10;

/**
 * One message for a scan: the jobs to tell the user about, best first, up to 10 with links and
 * "+n more". Undefined when there's nothing to say (no message beats an empty one).
 */
export function digest(
  jobs: readonly Job[],
  opts: { minScore: number; scopeLabel?: string; dashboardHint?: boolean; now?: number /** Companies in the user's config, as lowercase "ats:slug". */; yours?: ReadonlySet<string> },
): string | undefined {
  if (!jobs.length) return undefined;
  const strong = jobs.filter((j) => j.score >= opts.minScore).length;
  const head = `<b>${jobs.length} new job${jobs.length === 1 ? "" : "s"} for you</b>${strong ? ` · ${strong} strong` : ""}${opts.scopeLabel ? `\n<i>${esc(opts.scopeLabel)}</i>` : ""}`;
  const more = jobs.length > MAX_LINES ? `\n…and ${jobs.length - MAX_LINES} more on your Radar.` : opts.dashboardHint ? "\nSee them all on your Radar." : "";
  return `${head}\n\n${jobLines(jobs, opts.minScore, opts.now, opts.yours)}${more}`;
}

/**
 * The first 10 jobs, best first, one link each. As on the Radar, ⭐ marks your companies; a strong fit
 * says so after its score, and a job that breaks a dealbreaker (never a strong fit) says which.
 */
function jobLines(jobs: readonly Job[], minScore: number, now = Date.now(), yours?: ReadonlySet<string>): string {
  // The Radar's best-match order (fit plus freshness), so an alert lists jobs the way the Radar shows them.
  const rank = new Map(jobs.map((j) => [j, rankScore(j.score, j.postedAt ?? j.firstSeen, now)]));
  const sorted = [...jobs].sort((a, b) => rank.get(b)! - rank.get(a)! || (b.postedAt ?? b.firstSeen).localeCompare(a.postedAt ?? a.firstSeen));
  return sorted
    .slice(0, MAX_LINES)
    .map((j) => {
      const star = yours?.has(companyKey(j)) ? "⭐ " : "";
      const broken = j.why.dealbreakers?.[0];
      const strong = broken ? ` · ${esc(broken)}` : j.score >= minScore ? " · strong fit" : "";
      const where = j.location ? ` · ${esc(j.location.split(/[;|]/)[0]!.trim())}` : "";
      // The score sits after the company, labelled: before the title it read as part of it ("63 Staff Product Manager").
      return `${star}<a href="${esc(j.url)}">${esc(j.title)}</a>\n${esc(j.company)}${where} · score ${j.score}/100${strong}`;
    })
    .join("\n\n");
}

/** Where the dashboard runs (apps/web/vite.config.ts): on the user's own computer, not reachable from the phone. */
export const DASHBOARD_URL = "http://127.0.0.1:5173";

/** "greenhouse:acme" from a job id ("{ats}:{slug}:{atsJobId}"): matches a company in the config. */
const companyKey = (j: Job) => j.id.split(":", 2).join(":").toLowerCase();

/**
 * The message for "tell me when this scan is done": always sent. Says the scan is complete, then
 * splits the new jobs three ways that add up (your companies, strong fits elsewhere, the rest),
 * lists them, and points to the dashboard on the user's computer.
 */
export function finishedMessage(o: {
  scopeLabel: string;
  matches: number;
  newJobs: readonly Job[];
  minScore: number;
  /** Companies in the user's config, as lowercase "ats:slug". */
  yours?: ReadonlySet<string>;
  stopped?: boolean;
  done?: number;
  total?: number;
  now?: number;
}): string {
  const head = o.stopped
    ? `⏸ <b>Scan stopped</b> · ${esc(o.scopeLabel)}\n${o.done && o.total ? `Got to ${o.done.toLocaleString()} of ${o.total.toLocaleString()} companies. ` : ""}Start it again to carry on where it stopped.`
    : `✅ <b>Scan complete</b> · ${esc(o.scopeLabel)}${o.total ? `\n${o.total.toLocaleString()} companies checked.` : ""}`;
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const totals = `${plural(o.matches, "job matches", "jobs match")} you.`;
  const footer = `💻 Open RawJobs on your laptop to see every job: ${DASHBOARD_URL}`;
  if (!o.newJobs.length) return `${head}\n${totals}\n\nNo new jobs this time.\n\n${footer}`;

  const isYours = (j: Job) => !!o.yours?.has(companyKey(j));
  const yours = o.newJobs.filter(isYours);
  const yoursStrong = yours.filter((j) => j.score >= o.minScore).length;
  const strong = o.newJobs.filter((j) => !isYours(j) && j.score >= o.minScore).length;
  const rest = o.newJobs.length - yours.length - strong;
  const breakdown = [
    `⭐ ${yours.length.toLocaleString()} from your companies${yoursStrong ? ` (${yoursStrong} strong fit)` : ""}`,
    `🎯 ${plural(strong, "strong fit", "strong fits")} (score ${o.minScore}+) from other companies`,
    `• ${plural(rest, "other match", "other matches")}`,
  ].join("\n");
  const more = o.newJobs.length > MAX_LINES ? `\n…and ${o.newJobs.length - MAX_LINES} more.` : "";
  return `${head}\n${totals}\n\n<b>${plural(o.newJobs.length, "new job", "new jobs")}</b>\n${breakdown}\n\n${jobLines(o.newJobs, o.minScore, o.now, o.yours)}${more}\n\n${footer}`;
}
