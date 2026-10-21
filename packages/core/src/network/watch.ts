/**
 * Picks up LinkedIn's export from your Downloads folder while you wait for it. Node only.
 *
 * Every 10 s it lists the Downloads folder (names only, no subfolders) and opens only a file named
 * like LinkedIn's export (Basic_LinkedInDataExport_….zip). It skips empty and half-downloaded files,
 * tries each (name, size, modified time) once, and stops after one import or at `until` (48 h at
 * most). The watch lives in profile/network-watch.json, so a second RawJobs server sees it and a
 * restart carries on with it. Logs carry only the file's basename and size.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { type FileHandle, lstat, open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import { writeFileAtomic } from "../atomic";
import { exportFilesFromEntries, isAllowedEntry } from "./linkedin-export";
import type { NetworkStore } from "./store";
import { NETWORK_WATCH_PATH } from "./store";
import type { WatchState } from "./types";
import { readZipEntries, ZipError } from "./zip";
import { fileZipSource, inflateRawNode } from "./zip-node";

/** How often the folder is listed. */
export const WATCH_POLL_MS = 10_000;
/** The default watch, and the longest one. */
export const WATCH_DEFAULT_HOURS = 48;
export const WATCH_MAX_HOURS = 48;
/** A file modified this long before the watch started still counts (it may have just finished). */
const SINCE_SLACK_MS = 10 * 60_000;
const HOUR = 3_600_000;

/** The registry value that holds the Downloads folder on Windows. */
export const DOWNLOADS_GUID = "{374DE290-123F-4565-9164-39C4925E467B}";
const SHELL_FOLDERS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

/** LinkedIn's export file name: Basic_LinkedInDataExport_10-20-2026.zip, Complete_…, any case. */
export const LINKEDIN_ZIP = /^(?:basic|complete)?_?linked_?in_?data_?export[^/\\]*\.zip$/i;

/** True for LinkedIn's export, also as a browser's second copy ("… (1).zip"). */
export function isLinkedInExport(name: string): boolean {
  return LINKEDIN_ZIP.test(name.replace(/\s*\(\d+\)(?=\.zip$)/i, ""));
}

export type WatchErrorCode = "UNSUPPORTED" | "NO_ACCESS" | "NO_FOLDER";
export type WatchStartResult = { ok: true; watch: WatchState } | { ok: false; code: WatchErrorCode };

type Stats = { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean };
type Handle = { read(buf: Uint8Array, off: number, len: number, pos: number): Promise<{ bytesRead: number }>; close(): Promise<void> };

/** Everything the watcher touches outside itself, so tests never look at a real Downloads folder. */
export type WatchDeps = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: () => string;
  /** Runs a program without a shell; resolves with its stdout. */
  exec: (file: string, args: string[]) => Promise<string>;
  readdir: (dir: string) => Promise<string[]>;
  lstat: (path: string) => Promise<Stats>;
  stat: (path: string) => Promise<Stats>;
  readText: (path: string) => Promise<string>;
  open: (path: string) => Promise<Handle>;
  now: () => number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (timer: unknown) => void;
  log: (line: string) => void;
  /** Whether another process is still running (the server that owns a watch). */
  alive: (pid: number) => boolean;
  pid: number;
};

export const nodeWatchDeps = (): WatchDeps => ({
  platform: process.platform,
  env: process.env,
  homedir,
  exec: (file, args) =>
    new Promise((done, fail) => {
      execFile(file, args, { windowsHide: true, timeout: 2_000, encoding: "utf8" }, (err, stdout) => (err ? fail(err) : done(stdout)));
    }),
  readdir: (dir) => readdir(dir),
  lstat: (p) => lstat(p),
  stat: (p) => stat(p),
  readText: (p) => readFile(p, "utf8"),
  open: (p) => open(p, "r"),
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  cancel: (t) => clearTimeout(t as NodeJS.Timeout),
  log: (line) => console.log(line),
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  pid: process.pid,
});

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;

/** Windows' environment is case-insensitive; an injected one may not be. */
function envGet(env: WatchDeps["env"], name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const k = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
  return k ? env[k] : undefined;
}

/** Expand every %VAR%; null when one isn't set (then the path can't be trusted). */
export function expandWindowsVars(value: string, env: WatchDeps["env"]): string | null {
  let missing = false;
  const out = value.replace(/%([^%]+)%/g, (_, name: string) => {
    const v = envGet(env, name);
    if (v === undefined) missing = true;
    return v ?? "";
  });
  return missing ? null : out;
}

/** The value of `reg query … /v {GUID}`: "    {GUID}    REG_EXPAND_SZ    %USERPROFILE%\Downloads". */
export function parseRegQuery(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*\{[0-9A-F-]+\}\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** XDG_DOWNLOAD_DIR from user-dirs.dirs, with $HOME expanded. */
export function parseUserDirs(text: string, home: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"]*)"?\s*$/);
    if (!m?.[1]) continue;
    const p = m[1].replace(/^\$\{HOME\}|^\$HOME/, home);
    return p.startsWith("/") ? p : null;
  }
  return null;
}

async function isDir(deps: WatchDeps, p: string | null): Promise<boolean> {
  if (!p) return false;
  try {
    return (await deps.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where your browser saves downloads. RAWJOBS_DOWNLOADS points it elsewhere (for testing). Null on
 * macOS: its privacy controls usually stop a background process from reading Downloads.
 */
export async function downloadsFolder(deps: WatchDeps): Promise<string | null> {
  const override = deps.env.RAWJOBS_DOWNLOADS?.trim();
  if (override) return resolve(override);
  if (deps.platform === "darwin") return null;
  const home = deps.homedir();
  const path = deps.platform === "win32" ? win32 : posix;
  const fallback = path.join(home, "Downloads");
  if (deps.platform === "win32") {
    try {
      const raw = parseRegQuery(await deps.exec("reg", ["query", SHELL_FOLDERS, "/v", DOWNLOADS_GUID]));
      const p = raw && expandWindowsVars(raw, deps.env);
      if (await isDir(deps, p)) return p;
    } catch {
      // No such value, or reg took too long: the usual place.
    }
    return fallback;
  }
  try {
    const config = deps.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
    const p = parseUserDirs(await deps.readText(path.join(config, "user-dirs.dirs")), home);
    if (await isDir(deps, p)) return p;
  } catch {
    // No user-dirs.dirs: the usual place.
  }
  return fallback;
}

/** What profile/network-watch.json holds. */
type WatchFile = { app: "rawjobs"; kind: "network-watch"; version: 1; since: string; until: string; folder: string; owner: number; lastError?: string };

/** What the browser sees: the folder's name, never its full path. */
const publicState = (f: WatchFile): WatchState => ({ since: f.since, until: f.until, folder: basename(f.folder), ...(f.lastError ? { lastError: f.lastError } : {}) });

export function createWatcher(home: string, store: NetworkStore, deps: WatchDeps = nodeWatchDeps()) {
  const path = resolve(home, NETWORK_WATCH_PATH);
  /** The watch this server is running, if any. */
  let current: WatchFile | null = null;
  let timer: unknown = null;
  /** (name, size, mtime) of files already tried, so one is read again only after it changes. */
  const tried = new Set<string>();
  let polling = false;

  function readState(): WatchFile | null {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      if (code(e) !== "ENOENT") rmSync(path, { force: true });
      return null;
    }
    const r = raw as Partial<WatchFile> | null;
    const ok =
      r &&
      r.app === "rawjobs" &&
      r.kind === "network-watch" &&
      r.version === 1 &&
      typeof r.since === "string" &&
      typeof r.until === "string" &&
      typeof r.folder === "string" &&
      typeof r.owner === "number" &&
      Number.isFinite(Date.parse(r.until)) &&
      Number.isFinite(Date.parse(r.since));
    if (!ok || Date.parse(r.until as string) <= deps.now()) {
      rmSync(path, { force: true });
      return null;
    }
    return r as WatchFile;
  }
  function writeState(f: WatchFile) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, `${JSON.stringify(f)}\n`);
  }
  function next() {
    timer = deps.schedule(() => void poll(), WATCH_POLL_MS);
  }
  /** Stop this server's loop; `why` ends the watch for every server (the state file goes). */
  function end(why: "found" | "expired" | "stopped" | null) {
    if (timer !== null) deps.cancel(timer);
    timer = null;
    if (why) rmSync(path, { force: true });
    if (!current) return;
    current = null;
    tried.clear();
    if (why) deps.log(`Stopped watching Downloads (${why}).`);
  }

  /** One look at the folder. Exposed for tests; the timer calls it every 10 s. */
  async function poll(): Promise<void> {
    timer = null;
    if (!current || polling) return;
    polling = true;
    const since = current.since;
    // Stopped (or restarted) while this look waited on the disk: leave it to the new state.
    const gone = () => current?.since !== since;
    try {
      if (Date.parse(current.until) <= deps.now()) return end("expired");
      // Stopped, or taken over, by another server (or this one's DELETE): let it go.
      const onDisk = readState();
      if (!onDisk || onDisk.owner !== current.owner || onDisk.since !== current.since) return end(null);
      let names: string[];
      try {
        names = await deps.readdir(current.folder);
      } catch {
        return gone() ? undefined : next();
      }
      const from = Date.parse(since) - SINCE_SLACK_MS;
      for (const name of names) {
        if (!isLinkedInExport(name)) continue;
        const full = join(current.folder, name);
        let st: Stats;
        try {
          st = await deps.lstat(full);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size === 0 || st.mtimeMs < from) continue;
        const key = `${name}\0${st.size}\0${st.mtimeMs}`;
        if (tried.has(key)) continue;
        if (gone()) return;
        const r = await importFile(full, st.size);
        if (gone()) return;
        if (r === "busy") continue;
        tried.add(key);
        if (r === "ok") {
          deps.log(`Found ${name} (${st.size} bytes) in Downloads and imported it.`);
          return end("found");
        }
        deps.log(`Couldn't read ${name} (${st.size} bytes) from Downloads: ${r}.`);
        current = { ...(current as WatchFile), lastError: r };
        writeState(current);
      }
      if (!gone()) next();
    } finally {
      polling = false;
    }
  }

  /** "ok", "busy" (still being written or locked: try next time), or the error code. */
  async function importFile(full: string, size: number): Promise<"ok" | "busy" | string> {
    let handle: Handle;
    try {
      handle = await deps.open(full);
    } catch (e) {
      return code(e) === "EBUSY" || code(e) === "EPERM" || code(e) === "EACCES" || code(e) === "ENOENT" ? "busy" : "UNREADABLE";
    }
    try {
      const files = exportFilesFromEntries(await readZipEntries(fileZipSource(handle as unknown as FileHandle, size), inflateRawNode, isAllowedEntry));
      const r = await store.import(files, { source: "downloads", fileName: basename(full) });
      return r.ok ? "ok" : r.code;
    } catch (e) {
      if (e instanceof ZipError) return e.code;
      return code(e) === "EBUSY" || code(e) === "EPERM" ? "busy" : "UNREADABLE";
    } finally {
      await handle.close().catch(() => {});
    }
  }

  function run(f: WatchFile) {
    if (timer !== null) deps.cancel(timer);
    current = f;
    tried.clear();
    // The first look right away: the file may already be there.
    timer = deps.schedule(() => void poll(), 0);
  }

  return {
    poll,
    /** Whether the watch is offered on this computer (not on macOS in this release). */
    supported(): boolean {
      return deps.platform !== "darwin" || !!deps.env.RAWJOBS_DOWNLOADS?.trim();
    },
    /** Start watching for `hours` (at most 48). Lists the folder once first, to see that it can. */
    async start(hours = WATCH_DEFAULT_HOURS): Promise<WatchStartResult> {
      const folder = await downloadsFolder(deps);
      if (!folder) return { ok: false, code: "UNSUPPORTED" };
      try {
        await deps.readdir(folder);
      } catch (e) {
        const c = code(e);
        const why: WatchErrorCode = c === "EPERM" || c === "EACCES" ? "NO_ACCESS" : "NO_FOLDER";
        deps.log(`Couldn't watch Downloads: ${why}.`);
        return { ok: false, code: why };
      }
      const h = Math.min(WATCH_MAX_HOURS, Math.max(0.1, Number.isFinite(hours) ? hours : WATCH_DEFAULT_HOURS));
      const t = deps.now();
      const f: WatchFile = { app: "rawjobs", kind: "network-watch", version: 1, since: new Date(t).toISOString(), until: new Date(t + h * HOUR).toISOString(), folder, owner: deps.pid };
      writeState(f);
      deps.log(`Watching Downloads for LinkedIn's export until ${f.until}.`);
      run(f);
      return { ok: true, watch: publicState(f) };
    },
    /** End the watch, also one another server is running. */
    stop(): void {
      end("stopped");
    },
    /** On server start: carry on with a watch that's still running, unless another live server has it. */
    resume(): void {
      const f = readState();
      if (!f || current) return;
      if (f.owner !== deps.pid && deps.alive(f.owner)) return;
      const mine = { ...f, owner: deps.pid };
      writeState(mine);
      deps.log(`Watching Downloads for LinkedIn's export until ${f.until}.`);
      run(mine);
    },
    /** Before the server exits: stop the loop, keep the watch for the next start. */
    close(): void {
      end(null);
    },
    /** The watch any server on this computer is running, or null. */
    state(): WatchState | null {
      const f = readState();
      return f ? publicState(f) : null;
    },
  };
}

export type Watcher = ReturnType<typeof createWatcher>;
