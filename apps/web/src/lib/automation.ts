import type { DailySummaryStatus, ScheduledRun, ScheduleStatus, TelegramAction, TelegramStatus } from "@rawjobs/core/protocol";
import { ACTION_TIMEOUT_MS, fetchWithin, READ_TIMEOUT_MS } from "./net";
import type { ScanScope } from "./setup";

export type { DailySummaryStatus, ScheduledRun, ScheduleStatus, TelegramAction, TelegramStatus };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithin(url, { cache: "no-store", ...init }, init?.method && init.method !== "GET" ? ACTION_TIMEOUT_MS : READ_TIMEOUT_MS);
  } catch (err) {
    // No answer (the server restarting, a dropped connection, a time-out): the panel shows its error card.
    return { ok: false, error: (err as Error).message } as T;
  }
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

export const dailySummaryStatus = () => call<DailySummaryStatus>("/api/daily-summary");
export const saveDailySummary = (time: string) => call<DailySummaryStatus>("/api/daily-summary", { method: "POST", body: JSON.stringify({ time }) });
export const removeDailySummary = () => call<DailySummaryStatus>("/api/daily-summary", { method: "DELETE" });
export const testDailySummary = () => call<{ ok: boolean; error?: string }>("/api/daily-summary/test", { method: "POST" });
