import type { ApiFailure, ApiRoute, ApiRoutes, Health, RunEvent, ScanOrigin, TrackingRead } from "@rawjobs/core/protocol";
import { fetchWithin } from "./net";

/**
 * The local API, typed by its route map (ApiRoutes in @rawjobs/core/protocol, which the server sends
 * through too): a change to an answer on one side fails the typecheck on the other.
 */

/**
 * A route's answer. `ok: false` covers both an error status (`body`: the route's error answer, when
 * there was one) and no answer at all (`status` 0: offline, the server down or restarting, timed out
 * or aborted). `error` is always words to show or log.
 */
export type ApiResult<T, E = unknown> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; body: E | null };

export type ApiInit = RequestInit & {
  /** The URL, when it isn't the route's own path (a `:name` part filled in, a query string). */
  path?: string;
  /** Give up after this long (fetchWithin): `error` says "Timed out after N s". */
  timeoutMs?: number;
};

/** What an error answer says, in words: `errors` (the server's), `error` or `message`. */
function errorText(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { errors?: unknown; error?: unknown; message?: unknown };
  for (const v of [b.errors, b.error, b.message]) if (typeof v === "string" && v) return v;
  return undefined;
}

/**
 * Ask a route of the local API ("GET /api/health"). The method comes from the route; `init` is
 * fetch's, plus `path` and `timeoutMs`. Never throws.
 */
export async function getJson<R extends ApiRoute>(route: R, init: ApiInit = {}): Promise<ApiResult<ApiRoutes[R], ApiFailure<R>>> {
  const space = route.indexOf(" ");
  const method = route.slice(0, space);
  const { path = route.slice(space + 1), timeoutMs, ...rest } = init;
  // A GET leaves the method out, as a plain fetch(url) does.
  const request: RequestInit = method === "GET" ? rest : { ...rest, method };
  let res: Response;
  try {
    res = await (timeoutMs === undefined ? fetch(path, request) : fetchWithin(path, request, timeoutMs));
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err), body: null };
  }
  const body: unknown = await res.json().catch(() => null);
  // The one place an answer gets its type: the server sends ApiRoutes[R] (api.ts send()). Answers an old
  // server may shape differently are checked where they're read (isHealth, trackingRead, isRunEvent).
  if (res.ok && body !== null) return { ok: true, status: res.status, data: body as ApiRoutes[R] };
  return { ok: false, status: res.status, error: errorText(body) ?? `HTTP ${res.status}`, body: body as ApiFailure<R> | null };
}

// ---------- answers an older or newer server may shape differently ----------
// A tab left open across an update (or an update that went back) talks to a server of another
// version: these few answers are checked before they're used.

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const optional = (v: unknown, type: "string" | "number" | "boolean") => v === undefined || typeof v === type;
const ORIGINS: readonly ScanOrigin[] = ["page", "scheduled", "terminal"];

/** A /api/health answer whose fields have the types the page reads them as. */
export function isHealth(x: unknown): x is Health {
  if (!isObj(x)) return false;
  return (
    optional(x.ok, "boolean") &&
    optional(x.version, "string") &&
    optional(x.scanning, "boolean") &&
    optional(x.background, "boolean") &&
    (x.scanOrigin === undefined || x.scanOrigin === null || ORIGINS.includes(x.scanOrigin as ScanOrigin)) &&
    (x.dataVersion === undefined || x.dataVersion === null || typeof x.dataVersion === "string") &&
    optional(x.trackingRev, "number") &&
    (x.update === undefined || x.update === null || (isObj(x.update) && typeof x.update.version === "string")) &&
    optional(x.startLink, "boolean") &&
    optional(x.safeMode, "boolean") &&
    optional(x.platform, "string") &&
    optional(x.home, "string") &&
    optional(x.pid, "number")
  );
}

/**
 * A /api/tracking answer: the file's parts (null: nothing saved), and its revision, or `base: null`
 * from an older server that has none (it only takes whole parts by PUT). Null: not a tracking answer.
 */
export function trackingRead(x: unknown): { tracking: Partial<Record<string, unknown>> | null; base: { epoch: string; rev: number } | null } | null {
  if (!isObj(x) || !(x.tracking === undefined || x.tracking === null || isObj(x.tracking))) return null;
  const b = x as Partial<TrackingRead>;
  return { tracking: isObj(b.tracking) ? b.tracking : null, base: typeof b.rev === "number" && typeof b.epoch === "string" ? { epoch: b.epoch, rev: b.rev } : null };
}

/** One line of a scan's progress (POST and GET /api/run): an object with a `type`. Others are skipped. */
export function isRunEvent(x: unknown): x is RunEvent {
  return isObj(x) && typeof x.type === "string";
}
