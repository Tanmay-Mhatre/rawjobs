import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { rawjobsHome } from "./paths";

/**
 * Your own tracking from the dashboard: each job's status and note ("state"), Radar preferences
 * like saved views, hidden companies and hide rules ("prefs"), how the dashboard looks: theme,
 * contrast, feed density and age limit ("appearance"), and the small things it remembers between
 * visits, like the New line and what you dismissed ("browser"). Kept on this computer next to your
 * resume (profile/ is gitignored), so it no longer depends on which address the dashboard was opened at.
 * The dashboard owns the shape of both parts; this file only stores them.
 */
export const TRACKING_PATH = "profile/tracking.json";
const MAX_BYTES = 20_000_000;
/** One copy a day of the file as it was before that day's first save, the newest BACKUPS_KEPT kept. */
export const BACKUPS_DIR = "profile/backups";
export const BACKUPS_KEPT = 7;

export type TrackingParts = {
  state?: Record<string, unknown>;
  prefs?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
  browser?: Record<string, unknown>;
};
const PARTS = ["state", "prefs", "appearance", "browser"] as const;
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
      ...Object.fromEntries(PARTS.filter((part) => isRecord(raw[part])).map((part) => [part, raw[part]])),
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
  if (!isRecord(input)) return { ok: false, error: "Expected { state?, prefs?, appearance?, browser? }." };
  const patch: TrackingParts = {};
  for (const part of PARTS) {
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
  backUp(path, home);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return { ok: true, tracking: next };
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Before the day's first save, copy the file to profile/backups/tracking-YYYY-MM-DD.json and keep
 * the newest BACKUPS_KEPT copies: two tabs or versions overwriting each other can't lose more than
 * a day. A backup that fails never stops the save.
 */
export function backUp(path: string, home = rawjobsHome(), now = new Date()): void {
  try {
    if (!existsSync(path)) return;
    const dir = resolve(home, BACKUPS_DIR);
    const copy = resolve(dir, `tracking-${localDay(now)}.json`);
    if (existsSync(copy)) return;
    mkdirSync(dir, { recursive: true });
    copyFileSync(path, copy);
    const old = readdirSync(dir)
      .filter((f) => /^tracking-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .slice(0, -BACKUPS_KEPT);
    for (const f of old) rmSync(resolve(dir, f), { force: true });
  } catch {
    // A full disk or a locked folder: the save itself still goes ahead.
  }
}
