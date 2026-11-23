import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeSync } from "node:fs";
import { join } from "node:path";
import { renameWithRetry } from "./atomic";

/**
 * Big downloads (the job feed's full copy, the directory, an update) on any connection. A download
 * gives up only when no bytes arrive for IDLE_TIMEOUT_MS, not after a fixed total time, so a slow
 * link still finishes; and what arrived is kept in a `.part` file and continued with an HTTP Range
 * request next time, so a dropped connection doesn't start it again from zero.
 */
export const IDLE_TIMEOUT_MS = 30_000;
/** How long a scan waits for the directory and the job feed before it goes on with the local copies. */
export const SYNC_BUDGET_MS = 45_000;
/** A ceiling all the same, for a connection that trickles a byte at a time. */
export const MAX_DOWNLOAD_MS = 30 * 60_000;
/** Cached pieces older than this are dropped: their sync either finished or gave up long ago. */
const STALE_MS = 7 * 86_400_000;

/** Why a download failed. `transient`: worth trying again later (network, timeout, 5xx, 429). */
export class DownloadError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export type DownloadOptions = { idleMs?: number; maxMs?: number };

/**
 * Stream `url` into `part`, continuing from what's already there. Resolves once the whole body has
 * arrived; on failure the bytes so far stay in `part` for the next try.
 */
export async function fetchToFile(get: typeof fetch, url: string, part: string, opts: DownloadOptions = {}): Promise<void> {
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  const have = existsSync(part) ? statSync(part).size : 0;
  const controller = new AbortController();
  let idle: NodeJS.Timeout | undefined;
  const stall = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new DownloadError(`no data for ${Math.round(idleMs / 1000)} s`, true)), idleMs);
  };
  const cap = setTimeout(() => controller.abort(new DownloadError("took longer than the download limit", true)), opts.maxMs ?? MAX_DOWNLOAD_MS);
  stall();
  let fd: number | undefined;
  try {
    const res = await get(url, { redirect: "follow", signal: controller.signal, headers: have ? { range: `bytes=${have}-` } : {} }).catch((err) => {
      throw controller.signal.aborted ? controller.signal.reason : new DownloadError(`couldn't connect (${(err as Error).message})`, true);
    });
    if (res.status === 416) {
      // What's kept doesn't fit the file any more (it changed, or it's complete but unchecked): start again.
      rmSync(part, { force: true });
      throw new DownloadError("the saved part didn't fit the file", true);
    }
    if (!res.ok) throw new DownloadError(`HTTP ${res.status}`, res.status >= 500 || res.status === 429 || res.status === 408);
    // 206: the server continued where we were; 200: it sent the whole file, so start the part afresh.
    if (res.status !== 206 && have) truncateSync(part, 0);
    if (!res.body) throw new DownloadError("empty response", true);
    fd = openSync(part, "a");
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read().catch((err) => {
        throw controller.signal.aborted ? controller.signal.reason : new DownloadError(`the connection dropped (${(err as Error).message})`, true);
      });
      if (done) break;
      writeSync(fd, value);
      stall();
    }
  } finally {
    clearTimeout(idle);
    clearTimeout(cap);
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Download `url` into `cacheDir`, check it against `sha256`, and return its bytes. A file already
 * downloaded and checked there is returned without the network, so a sync that failed halfway only
 * fetches what's still missing next time. Throws a DownloadError; a checksum mismatch isn't transient.
 */
export async function downloadVerified(get: typeof fetch, url: string, sha256: string, cacheDir: string, opts: DownloadOptions = {}): Promise<Buffer> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new DownloadError("the manifest's checksum isn't valid", false);
  mkdirSync(cacheDir, { recursive: true });
  const done = join(cacheDir, sha256);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  if (existsSync(done)) {
    const buf = readFileSync(done);
    if (hash(buf) === sha256) return buf;
    rmSync(done, { force: true });
  }
  const part = `${done}.part`;
  await fetchToFile(get, url, part, opts);
  const buf = readFileSync(part);
  if (hash(buf) !== sha256) {
    rmSync(part, { force: true });
    throw new DownloadError(`${url.split("/").pop()} didn't match its checksum`, false);
  }
  renameWithRetry(part, done);
  return buf;
}

/** Drop cached downloads: all of them, or (`staleOnly`) those untouched for a week. Never throws. */
export function clearDownloads(cacheDir: string, staleOnly = false, now = Date.now()): void {
  try {
    if (!existsSync(cacheDir)) return;
    for (const f of readdirSync(cacheDir)) {
      const path = join(cacheDir, f);
      if (!staleOnly || now - statSync(path).mtimeMs > STALE_MS) rmSync(path, { force: true });
    }
  } catch {
    // A leftover file costs only disk; the next sync tries again.
  }
}

/**
 * Run a sync, but don't keep the caller waiting past `budgetMs`: then `late()` answers (the local copy
 * is used) while the work carries on downloading into the cache. The work checks `expired()` before
 * it changes anything on disk, so a late finish never swaps files under a scan that's already running;
 * the next sync finds the downloads ready and applies them at once.
 */
export async function withBudget<T>(budgetMs: number | undefined, work: (expired: () => boolean) => Promise<T>, late: () => T): Promise<T> {
  if (!budgetMs) return work(() => false);
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const running = work(() => expired);
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(late());
    }, budgetMs);
    timer.unref();
  });
  // A late failure has nobody to report to: what's downloaded stays in the cache.
  running.catch(() => {});
  try {
    return await Promise.race([running, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Thrown by a sync that ran out of budget before it could apply what it downloaded. */
export class LateError extends Error {
  constructor() {
    super("the sync ran past its budget");
    this.name = "LateError";
  }
}

/** Move a finished download into place (the update's bundle or Node archive). */
export async function downloadToFile(get: typeof fetch, url: string, file: string, opts: DownloadOptions = {}): Promise<void> {
  const part = `${file}.part`;
  await fetchToFile(get, url, part, opts);
  renameWithRetry(part, file);
}
