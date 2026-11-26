import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { isRunning } from "./pid";

/**
 * A lock file shared by processes of one RawJobs folder (a scan, the server, a scheduled task).
 * It's created with "wx", so of two processes starting at the same moment only one gets it, and it
 * holds that process's id. A lock left by a process that's gone is taken over, and so is one nobody
 * touched for `staleMs`: one whose process crashed and whose id now belongs to another program
 * (Windows reuses them). The holder touches it every `beatMs` until it lets go.
 */
export type Lock = { readonly path: string; release(): void };
export type LockOptions = { staleMs?: number; beatMs?: number };

const STALE_MS = 15 * 60_000;
const BEAT_MS = 60_000;
/**
 * A lock file that's still empty was created a moment ago and its process id isn't written yet: it's
 * held. Only an empty one older than this (its process died between the two steps) is taken over.
 */
const EMPTY_GRACE_MS = 5_000;
const POLL_MS = 200;

/** One heartbeat per lock this process holds, so a scan can hold the scan lock and a catalog lock at once. */
const beats = new Map<string, ReturnType<typeof setInterval>>();

/** The process id in a lock file; undefined when it's gone, empty or unreadable. */
export function readLockPid(path: string): number | undefined {
  try {
    return Number(readFileSync(path, "utf8")) || undefined;
  } catch {
    return undefined;
  }
}

/** Milliseconds since the lock was last touched; Infinity when it's gone. */
function ageMs(path: string, now = Date.now()): number {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Whether `pid` holding `path` still counts: alive and touched within staleMs (or, without a pid yet, just created). */
function holds(path: string, pid: number | undefined, staleMs: number): boolean {
  const age = ageMs(path);
  if (pid === undefined) return age < Math.min(EMPTY_GRACE_MS, staleMs);
  return age < staleMs && isRunning(pid);
}

/** Take the lock at `path`, or null when another live process holds it. */
export function acquireLock(path: string, o: LockOptions = {}): Lock | null {
  const staleMs = o.staleMs ?? STALE_MS;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      return held(path, o.beatMs ?? BEAT_MS);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const pid = readLockPid(path);
    if (pid === process.pid) return held(path, o.beatMs ?? BEAT_MS);
    if (holds(path, pid, staleMs)) return null;
    // Left by a process that's gone: remove it (unless another process just took it over) and try again.
    if (readLockPid(path) === pid) rmSync(path, { force: true });
  }
  return null;
}

/** acquireLock, trying again every 200 ms for up to `waitMs`. */
export async function acquireLockWaiting(path: string, o: LockOptions & { waitMs?: number } = {}): Promise<Lock | null> {
  const until = Date.now() + (o.waitMs ?? 0);
  for (;;) {
    const lock = acquireLock(path, o);
    if (lock || Date.now() >= until) return lock;
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

/** The process id holding `path` right now, when it's another live process; undefined otherwise. */
export function lockHolder(path: string, staleMs = STALE_MS): number | undefined {
  const pid = readLockPid(path);
  return pid !== undefined && pid !== process.pid && holds(path, pid, staleMs) ? pid : undefined;
}

/**
 * Run `fn` holding the lock, waiting up to `waitMs` for it; null (fn not run) when it stays busy.
 * The lock is let go however fn ends.
 */
export async function tryWithLock<T>(path: string, fn: () => T | Promise<T>, o: LockOptions & { waitMs?: number } = {}): Promise<T | null> {
  const lock = await acquireLockWaiting(path, o);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

function held(path: string, beatMs: number): Lock {
  clearInterval(beats.get(path));
  const beat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(path, now, now);
    } catch {
      // Gone: released, or taken over.
    }
  }, beatMs);
  beat.unref?.();
  beats.set(path, beat);
  return {
    path,
    release: () => releaseLock(path),
  };
}

/** Let go of a lock this process holds; one another process holds now is left alone. */
export function releaseLock(path: string): void {
  clearInterval(beats.get(path));
  beats.delete(path);
  if (readLockPid(path) === process.pid) rmSync(path, { force: true });
}
