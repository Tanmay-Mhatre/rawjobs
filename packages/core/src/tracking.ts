import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renameWithRetry, writeFileAtomic } from "./atomic";
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

/** The revision at which each key of each part last changed (kept in the file, never sent to the page). */
export type TrackingRevs = Partial<Record<TrackingPart, Record<string, number>>>;
export type TrackingPart = (typeof PARTS)[number];
/** The file as saved: the parts, plus `epoch` (a random id, new whenever the revisions start over)
 *  and `rev` (+1 per accepted save). Pages send `"<epoch>:<rev>"` back with each change. */
export type TrackingDoc = { tracking: TrackingFile; epoch: string; rev: number; revs: TrackingRevs };
export type TrackingRead = { doc: TrackingDoc | null; restoredFrom?: string };

/** The file is there but couldn't be read, even after waiting: never treat it as missing. */
export class TrackingUnreadable extends Error {
  constructor(cause: unknown) {
    super(`Couldn't read ${TRACKING_PATH}: ${(cause as Error)?.message ?? cause}`);
    this.name = "TrackingUnreadable";
  }
}
const UNREADABLE = "Couldn't read your tracking file, so nothing was changed. Try again in a moment.";

/** How the strict read reaches the disk; tests swap `readFile` for one that fails. */
export type TrackingIo = { readFile?: (path: string) => string; waitsMs?: number[] };
/** Errors Windows gives while antivirus or a backup app holds the file: wait about 2 s for it. */
const BUSY = new Set(["EBUSY", "EPERM", "EACCES"]);
const WAITS_MS = [10, 20, 50, 100, 200, 400, 600, 600];

const newEpoch = () => randomBytes(6).toString("hex");
/** A file saved before revisions (or by an older version after a rollback) has no epoch. Derive one
 *  from its content: stable across reads, and different from any epoch a page saw before. */
const contentEpoch = (text: string) => `c${createHash("sha256").update(text).digest("hex").slice(0, 11)}`;

function toDoc(raw: Record<string, unknown>, text: string): TrackingDoc {
  const tracking: TrackingFile = {
    app: "rawjobs",
    version: 1,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    ...Object.fromEntries(PARTS.filter((part) => isRecord(raw[part])).map((part) => [part, raw[part]])),
  };
  if (typeof raw.epoch !== "string" || !raw.epoch) return { tracking, epoch: contentEpoch(text), rev: 0, revs: {} };
  const rev = Number.isSafeInteger(raw.rev) && (raw.rev as number) >= 0 ? (raw.rev as number) : 0;
  const revs: TrackingRevs = {};
  if (isRecord(raw.revs))
    for (const part of PARTS) {
      const r = raw.revs[part];
      if (isRecord(r)) revs[part] = Object.fromEntries(Object.entries(r).filter(([, v]) => Number.isSafeInteger(v))) as Record<string, number>;
    }
  return { tracking, epoch: raw.epoch, rev, revs };
}

function readWithRetry(path: string, io: TrackingIo): string | null {
  const read = io.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const waits = io.waitsMs ?? WAITS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return read(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code === "ENOENT") return null;
      const wait = waits[attempt];
      if (wait === undefined || !BUSY.has(code)) throw new TrackingUnreadable(err);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

const parseRecord = (text: string): Record<string, unknown> | null => {
  try {
    const raw = JSON.parse(text) as unknown;
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
};

/**
 * The saved tracking for writers: `doc` is null only when there is no file yet. A file that is
 * there but locked (antivirus, a backup app) is tried again for about 2 s, then this throws
 * TrackingUnreadable, so a save never mistakes it for "nothing saved" and erases the other parts.
 * A file that doesn't parse is moved aside to tracking.json.bad-<time> and the newest backup that
 * parses is put back in its place (with a new epoch, so every open page rebases on it).
 */
export function readTrackingStrict(home = rawjobsHome(), io: TrackingIo = {}): TrackingRead {
  const path = resolve(home, TRACKING_PATH);
  if (!existsSync(path)) return { doc: null };
  const text = readWithRetry(path, io);
  if (text === null) return { doc: null };
  const raw = parseRecord(text);
  if (raw) return { doc: toDoc(raw, text) };
  try {
    renameWithRetry(path, `${path}.bad-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  } catch (err) {
    throw new TrackingUnreadable(err);
  }
  const dir = resolve(home, BACKUPS_DIR);
  const backups = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^tracking-.*\.json$/.test(f))
        .sort()
        .reverse()
    : [];
  for (const name of backups) {
    let backupText: string;
    try {
      backupText = readFileSync(resolve(dir, name), "utf8");
    } catch {
      continue;
    }
    const b = parseRecord(backupText);
    if (!b) continue;
    const old = toDoc(b, backupText);
    const doc: TrackingDoc = { ...old, epoch: newEpoch(), rev: old.rev + 1 };
    writeDoc(path, doc);
    return { doc, restoredFrom: name };
  }
  return { doc: null };
}

/**
 * `rev` of the file from its first bytes (written right after `epoch`, so `/api/health` needn't
 * parse the whole file). 0 for a file saved before revisions.
 */
export function trackingRevFromHead(head: string): number {
  const m = /^\{\s*"app"\s*:\s*"rawjobs"\s*,\s*"version"\s*:\s*1\s*,\s*"epoch"\s*:\s*"[^"]*"\s*,\s*"rev"\s*:\s*(\d+)/.exec(head);
  return m ? Number(m[1]) : 0;
}

function serialize(doc: TrackingDoc): string {
  const { app, version, updatedAt, ...parts } = doc.tracking;
  // epoch and rev first: trackingRevFromHead reads them from the file's first bytes.
  return `${JSON.stringify({ app, version, epoch: doc.epoch, rev: doc.rev, updatedAt, ...parts, revs: doc.revs }, null, 1)}\n`;
}

function writeDoc(path: string, doc: TrackingDoc, text = serialize(doc)): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, text);
}

/** Back up, then write the next version whole: a temporary file moved into place. */
function commit(home: string, doc: TrackingDoc): { ok: true } | { ok: false; status: 400; error: string } {
  const text = serialize(doc);
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, status: 400, error: "Tracking is too large to save (over 20 MB)." };
  const path = resolve(home, TRACKING_PATH);
  mkdirSync(dirname(path), { recursive: true });
  backUp(path, home);
  writeDoc(path, doc, text);
  return { ok: true };
}

/** The doc to change; `fresh` when there's no file yet (nothing to conflict with). */
function readForWrite(home: string, io: TrackingIo): { doc: TrackingDoc; fresh: boolean } | { ok: false; status: 503; error: string } {
  try {
    const { doc } = readTrackingStrict(home, io);
    return doc ? { doc, fresh: false } : { doc: { tracking: { app: "rawjobs", version: 1, updatedAt: "" }, epoch: newEpoch(), rev: 0, revs: {} }, fresh: true };
  } catch (err) {
    if (err instanceof TrackingUnreadable) return { ok: false, status: 503, error: UNREADABLE };
    throw err;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Replace the parts given and keep the others (the older page's whole-part save). Keys whose value
 * changed get this save's revision, so a newer page that changed them too sees a conflict instead
 * of overwriting them.
 */
export function saveTracking(
  input: unknown,
  home = rawjobsHome(),
  io: TrackingIo = {},
): { ok: true; tracking: TrackingFile; rev: number; epoch: string } | { ok: false; status: 400 | 503; error: string } {
  if (!isRecord(input)) return { ok: false, status: 400, error: "Expected { state?, prefs?, appearance?, browser? }." };
  const patch: TrackingParts = {};
  for (const part of PARTS) {
    if (input[part] === undefined) continue;
    if (!isRecord(input[part])) return { ok: false, status: 400, error: `"${part}" must be an object.` };
    patch[part] = input[part];
  }
  const read = readForWrite(home, io);
  if ("ok" in read) return read;
  const { doc } = read;
  const rev = doc.rev + 1;
  const revs: TrackingRevs = { ...doc.revs };
  for (const part of PARTS) {
    const next = patch[part];
    if (!next) continue;
    const prev = doc.tracking[part] ?? {};
    const partRevs = { ...revs[part] };
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) if (!same(prev[key], next[key])) partRevs[key] = rev;
    revs[part] = partRevs;
  }
  const tracking: TrackingFile = { ...doc.tracking, updatedAt: new Date().toISOString(), ...patch };
  const r = commit(home, { tracking, epoch: doc.epoch, rev, revs });
  return r.ok ? { ok: true, tracking, rev, epoch: doc.epoch } : r;
}

/** One part's key-level changes: entries to set (new or changed) and keys to remove. */
export type TrackingChange = { set?: Record<string, unknown>; del?: string[] };
export type TrackingConflict = { part: TrackingPart; key: string };
export type PatchResult =
  | { ok: true; rev: number; epoch: string; updatedAt: string }
  | { ok: false; status: 400 | 503; error: string }
  | { ok: false; status: 409; error: string; rev: number; epoch: string; tracking: TrackingFile; conflicts: TrackingConflict[] };

/** `"<epoch>:<rev>"` from an If-Match header (weak or strong), or null when it isn't one. */
export function parseTrackingTag(header: string | undefined): { epoch: string; rev: number } | null {
  const m = /^(?:W\/)?"([^":]*):(\d+)"$/.exec(header?.trim() ?? "");
  return m ? { epoch: m[1] ?? "", rev: Number(m[2]) } : null;
}
export const trackingTag = (epoch: string, rev: number) => `"${epoch}:${rev}"`;

/**
 * Apply key-level changes made on top of `base` (what the page last saw). A key changed by another
 * window since then, or any key when the file's epoch isn't the page's, is a conflict: then nothing
 * is applied and the page gets the current tracking to merge with and try again. Otherwise each key
 * gets the new revision (removed keys keep theirs, so an old page can't bring them back unseen).
 */
export function patchTracking(input: unknown, base: { epoch: string; rev: number }, home = rawjobsHome(), io: TrackingIo = {}): PatchResult {
  const bad = (error: string) => ({ ok: false as const, status: 400 as const, error });
  if (!isRecord(input) || !isRecord(input.changes)) return bad("Expected { changes: { state?, prefs?, appearance?, browser? } }.");
  const changes: Partial<Record<TrackingPart, { set: Record<string, unknown>; del: string[] }>> = {};
  for (const [part, change] of Object.entries(input.changes)) {
    if (!(PARTS as readonly string[]).includes(part)) return bad(`Unknown part "${part}".`);
    if (!isRecord(change)) return bad(`"${part}" must be { set?, del? }.`);
    const set = change.set ?? {};
    const del = change.del ?? [];
    if (!isRecord(set)) return bad(`"${part}.set" must be an object.`);
    if (!Array.isArray(del) || !del.every((k) => typeof k === "string")) return bad(`"${part}.del" must be a list of keys.`);
    const keys = [...Object.keys(set), ...del];
    if (keys.includes("__proto__")) return bad(`"${part}" has a key that can't be saved.`);
    if (new Set(keys).size !== keys.length) return bad(`"${part}" sets and removes the same key.`);
    changes[part as TrackingPart] = { set, del: del as string[] };
  }
  const read = readForWrite(home, io);
  if ("ok" in read) return read;
  const { doc, fresh } = read;
  const conflicts: TrackingConflict[] = [];
  if (!fresh)
    for (const [part, { set, del }] of Object.entries(changes) as [TrackingPart, { set: Record<string, unknown>; del: string[] }][])
      for (const key of [...Object.keys(set), ...del]) if (base.epoch !== doc.epoch || (doc.revs[part]?.[key] ?? 0) > base.rev) conflicts.push({ part, key });
  if (conflicts.length) return { ok: false, status: 409, error: "Changed in another window.", rev: doc.rev, epoch: doc.epoch, tracking: doc.tracking, conflicts };
  const rev = doc.rev + 1;
  const tracking: TrackingFile = { ...doc.tracking, updatedAt: new Date().toISOString() };
  const revs: TrackingRevs = { ...doc.revs };
  for (const [part, { set, del }] of Object.entries(changes) as [TrackingPart, { set: Record<string, unknown>; del: string[] }][]) {
    const next: Record<string, unknown> = { ...tracking[part], ...set };
    for (const key of del) delete next[key];
    tracking[part] = next;
    revs[part] = { ...revs[part], ...Object.fromEntries([...Object.keys(set), ...del].map((k) => [k, rev])) };
  }
  const r = commit(home, { tracking, epoch: doc.epoch, rev, revs });
  return r.ok ? { ok: true, rev, epoch: doc.epoch, updatedAt: tracking.updatedAt } : r;
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
