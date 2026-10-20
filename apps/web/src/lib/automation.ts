import type { ScanScope } from "./setup";

/** Telegram alerts as the local API reports them (the token is masked; it never comes back whole). */
export type TelegramStatus = { ok: boolean; token: string | null; bot: string | null; connected: boolean; enabled: boolean; fromEnv: boolean; error?: string };
export type TelegramAction = "token" | "connect" | "test" | "on" | "off" | "forget";

export type ScheduledRun = {
  startedAt: string;
  finishedAt?: string;
  scope: ScanScope;
  ok: boolean;
  matches?: number;
  newMatches?: number;
  notified?: string;
  stopped?: boolean;
  error?: string;
};
export type ScheduleStatus = {
  ok: boolean;
  error?: string;
  installed: boolean;
  supported: boolean;
  platform: string;
  settings?: { times: string[]; scope: ScanScope };
  nextRun?: string;
  lastRun?: ScheduledRun;
  runs: ScheduledRun[];
  problem?: string;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as T & { ok?: boolean; errors?: string; error?: string };
  // The local API answers { ok: false, errors } when the CLI itself failed.
  if (body.errors && !body.error) body.error = body.errors;
  return body;
}

export const telegramStatus = () => call<TelegramStatus>("/api/alerts/telegram");
export const telegramAction = (action: TelegramAction, body?: unknown) =>
  call<{ ok: boolean; error?: string; bot?: string; name?: string }>(`/api/alerts/telegram/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) });

export const scheduleStatus = () => call<ScheduleStatus>("/api/schedule");
export const saveSchedule = (times: string[], scope: ScanScope) => call<ScheduleStatus>("/api/schedule", { method: "POST", body: JSON.stringify({ times, scope }) });
export const removeSchedule = () => call<ScheduleStatus>("/api/schedule", { method: "DELETE" });
export const runScheduleNow = () => call<ScheduleStatus>("/api/schedule/run", { method: "POST" });

/** "Today in your Pipeline" each morning on Telegram: its scheduled task, and the last day it ran. */
export type DailySummaryStatus = {
  ok: boolean;
  error?: string;
  installed: boolean;
  supported: boolean;
  platform: string;
  settings?: { time: string };
  nextRun?: string;
  problem?: string;
  last: { day: string; at: string; result: "sent" | "nothing-due" } | null;
  /** Telegram is connected (a bot token and a chat). */
  telegram: boolean;
};
export const dailySummaryStatus = () => call<DailySummaryStatus>("/api/daily-summary");
export const saveDailySummary = (time: string) => call<DailySummaryStatus>("/api/daily-summary", { method: "POST", body: JSON.stringify({ time }) });
export const removeDailySummary = () => call<DailySummaryStatus>("/api/daily-summary", { method: "DELETE" });
export const testDailySummary = () => call<{ ok: boolean; error?: string }>("/api/daily-summary/test", { method: "POST" });
