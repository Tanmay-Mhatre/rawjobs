import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { rawjobsHome } from "./paths";

/**
 * Your own tracking from the dashboard: each job's status and note ("state"), and Radar preferences
 * like saved views, hidden companies and hide rules ("prefs"). Kept on this computer next to your
 * resume (profile/ is gitignored), so it no longer depends on which address the dashboard was opened at.
 * The dashboard owns the shape of both parts; this file only stores them.
 */
export const TRACKING_PATH = "profile/tracking.json";
const MAX_BYTES = 20_000_000;

export type TrackingParts = { state?: Record<string, unknown>; prefs?: Record<string, unknown> };
export type TrackingFile = TrackingParts & { app: "rawjobs"; version: 1; updatedAt: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The saved tracking, or null when there is none yet (or it can't be read). */
export function readTracking(home = rawjobsHome()): TrackingFile | null {
  const path = resolve(home, TRACKING_PATH);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(raw)) return null;
    return {
      app: "rawjobs",
      version: 1,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
      ...(isRecord(raw.state) ? { state: raw.state } : {}),
      ...(isRecord(raw.prefs) ? { prefs: raw.prefs } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Replace the parts given and keep the others. Written to a temporary file first and then moved
 * into place, so a crash halfway never leaves a broken file.
 */
export function saveTracking(input: unknown, home = rawjobsHome()): { ok: true; tracking: TrackingFile } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "Expected { state?, prefs? }." };
  const patch: TrackingParts = {};
  for (const part of ["state", "prefs"] as const) {
    if (input[part] === undefined) continue;
    if (!isRecord(input[part])) return { ok: false, error: `"${part}" must be an object.` };
    patch[part] = input[part];
  }
  const { app: _a, version: _v, updatedAt: _u, ...saved } = readTracking(home) ?? { app: "rawjobs", version: 1, updatedAt: "" };
  const next: TrackingFile = { app: "rawjobs", version: 1, updatedAt: new Date().toISOString(), ...saved, ...patch };
  const text = `${JSON.stringify(next, null, 1)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, error: "Tracking is too large to save (over 20 MB)." };
  const path = resolve(home, TRACKING_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return { ok: true, tracking: next };
}
