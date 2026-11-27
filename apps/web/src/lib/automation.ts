import type { ApiError, ApiRoute, ApiRoutes, DailySummaryStatus, ScheduledRun, ScheduleStatus, TelegramAction, TelegramStatus } from "@rawjobs/core/protocol";
import { type ApiInit, getJson } from "./api";
import { ACTION_TIMEOUT_MS, READ_TIMEOUT_MS } from "./net";
import type { ScanScope } from "./setup";

export type { DailySummaryStatus, ScheduledRun, ScheduleStatus, TelegramAction, TelegramStatus };

/** A status or action: its answer, or `{ ok: false, error }` (the panels show their error card). Never throws. */
async function call<R extends ApiRoute>(route: R, init: ApiInit = {}): Promise<Exclude<ApiRoutes[R], ApiError>> {
  type Answer = Exclude<ApiRoutes[R], ApiError>;
  const r = await getJson(route, { cache: "no-store", ...init, timeoutMs: route.startsWith("GET ") ? READ_TIMEOUT_MS : ACTION_TIMEOUT_MS });
  // No answer (the server restarting, a dropped connection, a time-out), or one that isn't JSON.
  if (!r.ok && !r.body) return { ok: false, error: r.error } as Answer;
  const body = (r.ok ? r.data : r.body) as Answer & { ok?: boolean; errors?: string; error?: string };
  // The local API answers { ok: false, errors } when the CLI itself failed.
  if (body.errors && !body.error) body.error = body.errors;
  return body;
}

export const telegramStatus = () => call("GET /api/alerts/telegram");
export const telegramAction = (action: TelegramAction, body?: unknown) => call("POST /api/alerts/telegram/:action", { path: `/api/alerts/telegram/${action}`, body: JSON.stringify(body ?? {}) });

export const scheduleStatus = () => call("GET /api/schedule");
export const saveSchedule = (times: string[], scope: ScanScope) => call("POST /api/schedule", { body: JSON.stringify({ times, scope }) });
export const removeSchedule = () => call("DELETE /api/schedule");
export const runScheduleNow = () => call("POST /api/schedule/run");

export const dailySummaryStatus = () => call("GET /api/daily-summary");
export const saveDailySummary = (time: string) => call("POST /api/daily-summary", { body: JSON.stringify({ time }) });
export const removeDailySummary = () => call("DELETE /api/daily-summary");
export const testDailySummary = () => call("POST /api/daily-summary/test");
