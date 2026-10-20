import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, type WriteFileOptions } from "node:fs";

/**
 * Write a file whole or not at all: into a temp file next to it, then renamed over it. A crash, a
 * full disk or a killed scan leaves the old file, never half of the new one.
 */
export function writeFileAtomic(path: string, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data, options);
    renameWithRetry(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Errors Windows gives while another program (the server, antivirus, a backup app) has the file open. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const WAITS_MS = [10, 20, 50, 100, 200, 400, 800];

/**
 * Rename, trying again for about 1.5 s while the target is briefly held open. Windows can't replace
 * a file another program is reading; that lasts milliseconds, so it shouldn't fail a whole scan.
 */
export function renameWithRetry(from: string, to: string, rename: (from: string, to: string) => void = renameSync): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const wait = WAITS_MS[attempt];
      if (wait === undefined || !BUSY.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

/**
 * A JSON file, or undefined when it's missing. One that doesn't parse (written by an older version
 * without writeFileAtomic, or damaged on disk) is moved aside to `<name>.bad` and treated as
 * missing, so one bad file doesn't stop every scan after it.
 */
export function readJsonOrSetAside<T>(path: string, onSetAside?: (badPath: string) => void): T | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    const bad = `${path}.bad`;
    renameSync(path, bad);
    onSetAside?.(bad);
    return undefined;
  }
}
