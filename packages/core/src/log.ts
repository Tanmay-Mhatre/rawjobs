import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic";

/**
 * Log files that rotate as they grow: `file` moves to `file.1` (and `.1` to `.2`…) once it passes
 * `maxBytes`, checked at open and before every write, so a process that runs for weeks never fills the
 * disk. Writes never throw (a full disk must not stop a scan or the server).
 */
export type Log = { readonly path: string; write(text: string): void };
export type LogOptions = { maxBytes?: number; keep?: number };

export function openLog(file: string, o: LogOptions = {}): Log {
  const maxBytes = o.maxBytes ?? 5_000_000;
  const keep = Math.max(1, o.keep ?? 3);
  let size = 0;
  try {
    mkdirSync(dirname(file), { recursive: true });
    size = statSync(file).size;
  } catch {
    // no log yet
  }
  const rotate = () => {
    for (let i = keep - 1; i >= 1; i--) tryRename(`${file}.${i}`, `${file}.${i + 1}`);
    tryRename(file, `${file}.1`);
    size = 0;
  };
  if (size > maxBytes) rotate();
  return {
    path: file,
    write(text) {
      const line = `${new Date().toISOString()} ${text.endsWith("\n") ? text : `${text}\n`}`;
      const bytes = Buffer.byteLength(line);
      try {
        if (size > 0 && size + bytes > maxBytes) rotate();
        appendFileSync(file, line);
        size += bytes;
      } catch {
        // a full disk shouldn't stop anything
      }
    },
  };
}

function tryRename(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    // not there, or held open: the next rotation tries again
  }
}

/** Send this process's output to `log` too (it still goes where it went before). */
export function teeConsole(log: Log): void {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      log.write(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return (write as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
  }
}

// ---------- crashes ----------

export type CrashEntry = { at: string; version: string; where: string; origin: string; message: string; stackHash: string };
const CRASHES_FILE = "crashes.json";
const KEEP_CRASHES = 20;
/** This many crashes within SAFE_WINDOW_MS: start with less background work (safe mode). */
export const SAFE_MODE_CRASHES = 3;
export const SAFE_WINDOW_MS = 10 * 60_000;

export const crashesFile = (logDir: string) => join(logDir, CRASHES_FILE);

export function readCrashes(logDir: string): CrashEntry[] {
  try {
    const list = JSON.parse(readFileSync(crashesFile(logDir), "utf8")) as unknown;
    return Array.isArray(list) ? (list as CrashEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Note a crash: its stack in `log` (when given) and an entry in `<logDir>/crashes.json`, both
 * written synchronously, since the process is about to end. Never throws.
 */
export function recordCrash(logDir: string, err: unknown, o: { origin: string; where: string; version: string; log?: Log; now?: Date }): void {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    o.log?.write(`RawJobs crashed (${o.where}, ${o.origin}): ${e.stack ?? e.message}`);
  } catch {
    // keep going: the entry below matters more
  }
  try {
    const entry: CrashEntry = {
      at: (o.now ?? new Date()).toISOString(),
      version: o.version,
      where: o.where,
      origin: o.origin,
      message: e.message.slice(0, 500),
      stackHash: createHash("sha256")
        .update(e.stack ?? e.message)
        .digest("hex")
        .slice(0, 12),
    };
    mkdirSync(logDir, { recursive: true });
    writeFileAtomic(crashesFile(logDir), JSON.stringify([entry, ...readCrashes(logDir)].slice(0, KEEP_CRASHES), null, 1));
  } catch {
    // a full disk: nothing more to do
  }
}

/** Crashes of `where` in the last SAFE_WINDOW_MS. */
export function recentCrashes(logDir: string, where: string, now = Date.now()): number {
  return readCrashes(logDir).filter((c) => c.where === where && now - Date.parse(c.at) < SAFE_WINDOW_MS).length;
}

/**
 * Out-of-memory and other fatal errors end Node without an exception to catch: have it write a
 * diagnostic report into `<logDir>/reports` instead (environment variables left out). Call
 * `collectReports` at the next start to turn them into crash entries.
 */
export function reportFatalErrors(logDir: string): void {
  try {
    const dir = join(logDir, "reports");
    mkdirSync(dir, { recursive: true });
    process.report.directory = dir;
    // Node 22.13+ / 23.3+: environment variables (they may hold tokens) stay out of the report.
    if ("excludeEnv" in process.report) (process.report as { excludeEnv: boolean }).excludeEnv = true;
    process.report.reportOnFatalError = true;
  } catch {
    // reports aren't available here
  }
}

/** Turn diagnostic reports left by a fatal error into crash entries; keeps the newest 3 report files. */
export function collectReports(logDir: string, o: { where: string; version: string }): number {
  const dir = join(logDir, "reports");
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return 0;
  }
  const seenFile = join(dir, "seen.txt");
  let seen = new Set<string>();
  try {
    seen = new Set(readFileSync(seenFile, "utf8").split("\n").filter(Boolean));
  } catch {
    // none seen yet
  }
  let added = 0;
  for (const f of files) {
    if (seen.has(f)) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { header?: { event?: string; trigger?: string; dumpEventTime?: string }; javascriptStack?: { message?: string } };
      const err = new Error(`${r.header?.event ?? "Fatal error"}${r.javascriptStack?.message ? `: ${r.javascriptStack.message}` : ""}`);
      const at = Date.parse(r.header?.dumpEventTime ?? "");
      recordCrash(logDir, err, { origin: r.header?.trigger ?? "FatalError", where: o.where, version: o.version, now: Number.isFinite(at) ? new Date(at) : statSync(join(dir, f)).mtime });
      added++;
    } catch {
      // unreadable report: skip it
    }
    seen.add(f);
  }
  for (const old of files.slice(0, -3)) {
    rmSync(join(dir, old), { force: true });
    seen.delete(old);
  }
  try {
    writeFileAtomic(seenFile, [...seen].join("\n"));
  } catch {
    // try again next time
  }
  return added;
}
