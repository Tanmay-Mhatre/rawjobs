import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync, type WriteFileOptions } from "node:fs";
import { dirname } from "node:path";

export interface AtomicOptions {
  /**
   * Flush the temp file to disk before the rename (and, on POSIX, the folder after it), so a power
   * cut can't leave an empty file. A few ms per write: only for the user's own files.
   */
  fsync?: boolean;
  /** How long to keep retrying the rename while Windows has the target open (default about 1.5 s). */
  retryMs?: number;
}

/** Test seam: the fs calls the fsync path makes. */
export const fsOps = { openSync, writeSync, fsyncSync, closeSync };

/**
 * Write a file whole or not at all: into a temp file next to it, then renamed over it. A crash, a
 * full disk or a killed scan leaves the old file, never half of the new one.
 */
export function writeFileAtomic(path: string, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions, atomic: AtomicOptions = {}): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    if (atomic.fsync) writeSynced(tmp, data, options);
    else writeFileSync(tmp, data, options);
    renameWithRetry(tmp, path, renameSync, { maxMs: atomic.retryMs });
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  if (atomic.fsync && process.platform !== "win32") syncDir(dirname(path));
}

function writeSynced(tmp: string, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions): void {
  const o = typeof options === "string" ? { encoding: options } : (options ?? {});
  const fd = fsOps.openSync(tmp, "w", o.mode);
  try {
    const buf = typeof data === "string" ? Buffer.from(data, (o.encoding as BufferEncoding | null | undefined) ?? "utf8") : data;
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let off = 0; off < bytes.length; ) off += fsOps.writeSync(fd, bytes, off);
    fsOps.fsyncSync(fd);
  } finally {
    fsOps.closeSync(fd);
  }
}

/** Make the rename itself durable on POSIX. Windows can't open a folder, and NTFS journals renames. */
function syncDir(dir: string): void {
  try {
    const fd = fsOps.openSync(dir, "r");
    try {
      fsOps.fsyncSync(fd);
    } finally {
      fsOps.closeSync(fd);
    }
  } catch {
    // Some file systems refuse fsync on a folder; the file itself is already on disk.
  }
}

/** Errors Windows gives while another program (the server, antivirus, a backup app) has the file open. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const WAITS_MS = [10, 20, 50, 100, 200, 400, 800];

/**
 * Rename, trying again for about 1.5 s (or `maxMs`) while the target is briefly held open. Windows
 * can't replace a file another program is reading; that lasts milliseconds, so it shouldn't fail a
 * whole scan.
 */
export function renameWithRetry(from: string, to: string, rename: (from: string, to: string) => void = renameSync, { maxMs }: { maxMs?: number } = {}): void {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const step = WAITS_MS[Math.min(attempt, WAITS_MS.length - 1)] as number;
      const budget = maxMs ?? WAITS_MS.reduce((a, b) => a + b, 0);
      const wait = Math.min(step, budget - waited);
      if (wait <= 0 || !BUSY.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
      waited += wait;
    }
  }
}

/**
 * A JSON file, or undefined when it's missing. One that doesn't parse (written by an older version
 * without writeFileAtomic, or damaged on disk) is moved aside to `<name>.bad` and treated as
 * missing, so one bad file doesn't stop every scan after it. If Windows won't let it move, it stays
 * where it is (still treated as missing) and the next read tries again.
 */
export function readJsonOrSetAside<T>(path: string, onSetAside?: (badPath: string) => void, rename: (from: string, to: string) => void = renameSync): T | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    const bad = `${path}.bad`;
    try {
      renameWithRetry(path, bad, rename);
    } catch (err) {
      console.warn(`${path} is damaged and couldn't be moved aside (${(err as Error).message}); ignoring it for now.`);
      return undefined;
    }
    onSetAside?.(bad);
    return undefined;
  }
}
