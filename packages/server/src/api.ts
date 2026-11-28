import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  APP_VERSION,
  CONFIG_CANDIDATES,
  cleanMove,
  cliCommand,
  contributeUrl,
  codeStamp,
  companyKey,
  findConfigPath,
  loadConfig,
  type Command,
  fileStamp,
  pruneCache,
  queueMove,
  scanLockHeld,
  scanLockHolder,
  readLiveHead,
  liveInBackground,
  limiter,
  LIVE_FILE,
  readResume,
  setupStatus,
  suggestCacheDir,
  telegramStatus,
  writeCacheFile,
} from "@rawjobs/core";
import {
  MAX_DOWNLOAD_MS,
  parseTrackingTag,
  patchTracking,
  readTrackingStrict,
  saveTracking,
  suggestPoolSize,
  TRACKING_PATH,
  trackingRevFromHead,
  trackingTag,
  TrackingUnreadable,
  type ScanScope,
  type TrackingDoc,
} from "@rawjobs/core";
import { awakeTimeout, CONNECTION_ID, createNetworkStore, createReminder, createWatcher, nodeWatchDeps, type ReminderDeps, sendTelegram, telegramSecrets, type WatchDeps } from "@rawjobs/core";
import type { ApiFailure, ApiRoute, ApiRoutes, NetworkError, ScanOrigin } from "@rawjobs/core/protocol";
import { folderId } from "@rawjobs/core/update";
import { CSP_REPORT_PATH, cspReportLine } from "./csp";
import { refuse, refuseHost } from "./guard";
import { directorySearch } from "./directory-search";
import { createReaders } from "./readers";
import { scanLines, type ScanLines } from "./scan-lines";
import type { Updater } from "./updater";

export type ApiOptions = {
  /** Your RawJobs folder: rawjobs.config.local.yaml and profile/. The CLI runs here. */
  home: string;
  /** The run output folder (jobs.json, meta.json, catalog/…). */
  dataDir: string;
  /** How to start the CLI. Default: this copy's own (runtime's cliCommand()). */
  cli?: Command;
  /** Reported by /api/health. Default: this copy's version. */
  version?: string;
  /** Answers /api/update (an installed copy's updates); without it, it says this copy doesn't update itself. */
  updater?: Pick<Updater, "route" | "updating" | "updateHint">;
  /** Whether rawjobs://open starts RawJobs on this computer (/api/health's startLink). Default: no. */
  startLink?: () => boolean;
  /** Whether the server started in safe mode after crashing several times (/api/health's safeMode). Default: no. */
  safeMode?: () => boolean;
  /** Show a saved file in the file manager (the diagnostics file). Default: nothing. */
  reveal?: (path: string) => void;
  /** The Downloads watcher's view of the computer (tests point it at a temp folder). Default: the real one. */
  watchDeps?: Partial<WatchDeps>;
  /** The LinkedIn file reminder's clock and Telegram (tests use a fake clock). Default: the real ones. */
  reminderDeps?: Partial<ReminderDeps>;
  /** How long the directory search process is kept without a request. Default: 10 minutes. */
  searchIdleMs?: number;
};

const HOUR_MS = 60 * 60_000;
/** Short CLI runs (reads, saves, a directory update) at once; more wait their turn. */
const COLLECT_MAX = 3;
/** Requests that may change what the kept read-only answers show (any but GET). */
const WRITES = /^\/api\/(setup|directory|alerts|schedule|daily-summary|run|check)(\/|$)/;
/** POSTs that only read (Browse all's search sends its filters as a body): they keep the kept answers. */
const READ_POSTS = new Set(["/api/directory/search", "/api/directory/names", "/api/directory/warm"]);
/** A page served from this computer (any port): may read /api/health from another port. */
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;

/** One line of the scan's NDJSON progress. */
type Line = string;

/** The first `bytes` of a file, as text. */
function readHead(path: string, bytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * The dashboard's API: everything it needs to set up and run RawJobs on this computer.
 *   GET  /api/health          { ok, version, scanning, background, dataVersion, trackingRev, update, startLink, platform, home, pid }: is the server up,
 *                             which version, one waiting to install, and (for the page to remember while it's down) how to
 *                             start it again. background: a scan this server didn't start (a scheduled one) is running.
 *                             scanOrigin: who started the running scan ("page", "scheduled", "terminal"; null: none)
 *                             dataVersion: meta.json's generatedAt, so an open page sees when a scan wrote new results
 *                             trackingRev: tracking.json's rev, so an open page pulls another window's saves
 *   GET/PUT /api/tracking     your statuses, notes and Radar preferences (profile/tracking.json)
 *   PATCH /api/tracking       key-level changes, If-Match "<epoch>:<rev>"; 409 with the current tracking on a conflict
 *   GET  /api/network         your LinkedIn connections: { status, me, watchable, reminder } (me: your own positions and schools, or
 *                             null; status.watch: a Downloads watch any server here is running; watchable: offered here)
 *   POST /api/network/watch   { hours? }: watch Downloads for LinkedIn's export. { watch: { since, until, folder } }, or
 *                             400 { watch: null, error: "NO_ACCESS" | "NO_FOLDER" | "UNSUPPORTED" }
 *   DELETE /api/network/watch stop watching Downloads
 *   POST /api/network/reminder { hours? }: remind me to add LinkedIn's file (48 h; 24 h to snooze; at most 72 h).
 *                             { reminder: { at, due } }. GET /api/network has it too (reminder: … | null)
 *   DELETE /api/network/reminder cancel or dismiss the reminder
 *   POST /api/network/import  { fileName?, files: { connections?, positions?, education? } }: the three CSV texts the
 *                             page read from LinkedIn's export ZIP. { ok: true, status }, or { ok: false, errors: [{ code }] }
 *                             (400; 413 with TOO_BIG for a body over 12 MB)
 *   GET  /api/network/summary { importedAt, counts: { networkKey: n } }, with ETag importedAt (304 when unchanged)
 *   GET  /api/network/people?company=  who you know there: { how, people } (days since you connected, not the date)
 *   PUT  /api/network/friends { id, friend }: mark or unmark a close contact
 *   DELETE /api/network       delete your connections (profile/network.json and the files next to it)
 *   GET  /api/update          an installed copy's updates (POST …/check, …/apply, …/seen; PUT …/settings)
 *   GET  /api/setup           setup status (+ current config)
 *   POST /api/setup/config    validate and save rawjobs.config.local.yaml
 *   POST /api/setup/reset     start setup over: move the config to rawjobs.config.local.backup.yaml
 *   POST /api/setup/check     detect + live-check careers URLs
 *   GET/POST/DELETE /api/setup/resume  read / save / remove the master resume (profile/resume.md, gitignored)
 *   GET  /api/directory       the shared company directory's local copy (and what's waiting to be shared)
 *   POST /api/directory/update download the latest shared directory and share waiting additions (and careers-link moves)
 *   POST /api/directory/search Browse all: { q, industry, system, page, pageSize, watched, fit, hideWatched } → one page of
 *                             results ({ rows, total, exact, page, pageSize, searchReady }, or { missing: true })
 *   POST /api/directory/names  { keys }: { names: { key: name } } for directory keys (the Hidden list)
 *   POST /api/directory/warm   read the directory ahead of Browse all ({ present })
 *   POST /api/directory/moves  { name, from, to }: queue a confirmed careers-link move to share with the next directory
 *                             update (never sent right away). { queued: true }, { queued: false, reason } when sharing
 *                             is off, or 400 { ok: false, errors } for a body that isn't a move
 *   POST /api/companies/suggest  companies that fit a profile ({ profile?, watched?, hidden? }), with lookalikes of past employers
 *   GET  /api/companies/suggest/size  { companies }: how many companies a suggestion request checks (null when unknown)
 *   POST /api/run             scan ({ scope: "mine" | "yours" | "all", fresh? }); streams NDJSON progress. A background
 *                             check (after Scan now, this server's or a scheduled scan's) is stopped first: it carries on after.
 *                             { background: true }: only the background check, carrying on a paused one (Resume now)
 *   GET  /api/run             follow the running scan from the start (204 when none is running). A scan this server
 *                             didn't start is followed through its live file (data/scan-live.ndjson); x-rawjobs-origin says whose
 *   POST /api/run/stop        stop the running scan within seconds (it can be resumed), whoever started it
 *   POST /api/run/notify      send a Telegram message when the running scan finishes, whoever started it
 *   GET  /api/scan/plan       what each scan type covers: companies, about how long, a stopped scan to resume
 *   GET  /api/alerts/telegram Telegram alerts: set up? on? (the token is never sent back, only masked)
 *   POST /api/alerts/telegram/{token|connect|test|on|off|forget}   set up and manage Telegram alerts
 *   GET/POST/DELETE /api/schedule   scheduled scans on this computer: status, install ({ times, scope }), remove
 *   POST /api/schedule/run    run the scheduled scan now
 *   GET/POST/DELETE /api/daily-summary   "Today in your Pipeline" on Telegram each morning: status (with the last
 *                             day it ran), install ({ time }), remove
 *   POST /api/daily-summary/test   send the daily summary now as a test
 *   POST /api/check           check directory companies now ({ keys: ["ats:slug"] }); answers with the done event
 * A scan belongs to the server, not to the tab that started it: closing or reloading the tab
 * never stops it, and GET /api/run picks it up again.
 */
export function createApi(opts: ApiOptions) {
  const { home, dataDir } = opts;
  const cliCmd = opts.cli ?? cliCommand();
  const version = opts.version ?? APP_VERSION;
  const network = createNetworkStore(home);
  const watcher = createWatcher(home, network, { ...nodeWatchDeps(), ...opts.watchDeps });
  const reminder = createReminder(home, network, {
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    },
    cancel: (t) => clearTimeout(t as NodeJS.Timeout),
    // Only when Telegram alerts are set up and on.
    telegram: () => {
      const secrets = telegramSecrets(home);
      return secrets.token && secrets.chatId && telegramStatus(home).enabled ? secrets : null;
    },
    send: (text, secrets) => sendTelegram(text, secrets),
    log: (line) => console.log(line),
    ...opts.reminderDeps,
  });

  /** Run `rawjobs <args>` from the repo root (no shell, so no quoting issues). */
  function cli(args: string[], stdin?: string): ChildProcess {
    // Room for the job feed (a few hundred MB at peak) without letting a runaway scan take the laptop.
    const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=2048`.trim() };
    const child = spawn(cliCmd.command, [...cliCmd.args, ...args], { cwd: home, env, windowsHide: true });
    if (stdin !== undefined) child.stdin!.end(stdin);
    else child.stdin!.end();
    return child;
  }

  /** Browse all's search: one `rawjobs directory search --serve` kept while the page uses it. */
  const search = directorySearch(
    () => {
      // A 250k-company directory and its index take a few hundred MB: room, with a cap.
      const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=2048`.trim() };
      return spawn(cliCmd.command, [...cliCmd.args, "directory", "search", "--serve", "--data", dataDir], { cwd: home, env, windowsHide: true });
    },
    { idleMs: opts.searchIdleMs },
  );
  /** A search route: its JSON body to the search process, its answer back (a body too big or not JSON is a 400). */
  async function searchRoute<R extends `POST /api/directory/${"search" | "names" | "warm"}`>(res: ServerResponse, req: IncomingMessage, route: R, op: "search" | "names" | "warm") {
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req, 4_000_000)) || "{}");
    } catch (err) {
      return fail(res, (err as Error).message, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(res, "Send a JSON object.", 400);
    try {
      // The search process's own answer (packages/cli directory search --serve).
      return send(res, route, await search.ask<ApiRoutes[R]>(op, body as Record<string, unknown>));
    } catch (err) {
      return fail(res, (err as Error).message, 503);
    }
  }

  /**
   * Run the CLI and collect its output. A run that hangs (a stalled download, say) is stopped after
   * `timeoutMs`, so a request (and the "checking" flag it holds) can't wait forever. At most
   * COLLECT_MAX run at once, the rest waiting their turn (scans start through `cli` and aren't held up).
   */
  const collectSlot = limiter(COLLECT_MAX);
  function collect(args: string[], stdin?: string, timeoutMs = 600_000): Promise<{ code: number; stdout: string; stderr: string }> {
    return collectSlot(() => collectNow(args, stdin, timeoutMs));
  }
  function collectNow(args: string[], stdin: string | undefined, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((done) => {
      const child = cli(args, stdin);
      let stdout = "";
      let stderr = "";
      // Awake time only: a run the computer slept through isn't stopped the moment it wakes.
      const cancel = awakeTimeout(timeoutMs, () => {
        child.kill();
        done({
          code: 1,
          stdout,
          stderr: `${stderr}
Stopped after ${Math.round(timeoutMs / 1000)} s without finishing.`.trim(),
        });
      });
      const finish = (r: { code: number; stdout: string; stderr: string }) => {
        cancel();
        done(r);
      };
      child.stdout!.on("data", (d) => (stdout += d));
      child.stderr!.on("data", (d) => (stderr += d));
      child.on("error", (err) => finish({ code: 1, stdout, stderr: String(err) }));
      child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
    });
  }

  /**
   * Read-only answers the page asks for often, kept a while: quick ones read in this process (no CLI
   * run), slow ones (the scan plan reads the whole directory for seconds) from the CLI as before.
   * Forgotten after a save to what they show (WRITES) and when a scan or check ends.
   */
  const readers = createReaders();
  async function respondRead<R extends ApiRoute>(res: ServerResponse, route: R, read: () => ApiRoutes[R] | Promise<ApiRoutes[R]>) {
    try {
      send(res, route, await read());
    } catch (err) {
      fail(res, String((err as Error).message ?? err), 500);
    }
  }
  /**
   * The CLI's JSON answer, kept as `readers.memo` does; a run that fails isn't kept. Its type is what
   * the CLI command prints (packages/cli), which this process can't check.
   */
  const readCli = <R extends ApiRoute>(_route: R, key: string, ttlMs: number, args: string[]) =>
    readers.memo(key, ttlMs, async (): Promise<ApiRoutes[R]> => {
      const r = await collect(args);
      const out = r.stdout.trim();
      if (!out.startsWith("{") && !out.startsWith("[")) throw new Error((r.stderr || r.stdout || "rawjobs failed").trim().slice(-2000));
      return JSON.parse(out) as ApiRoutes[R];
    });

  /** Send the CLI's JSON stdout as the response, or a JSON error. `route`: whose answer it is (ApiRoutes has what the CLI prints). */
  async function respondJson(res: ServerResponse, route: ApiRoute, args: string[], stdin?: string) {
    respondOutput(res, route, await collect(args, stdin));
  }

  function respondOutput(res: ServerResponse, _route: ApiRoute, r: { code: number; stdout: string; stderr: string }) {
    res.setHeader("content-type", "application/json");
    const out = r.stdout.trim();
    if (out.startsWith("{") || out.startsWith("[")) {
      res.end(out);
    } else {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, errors: (r.stderr || r.stdout || "rawjobs failed").trim().slice(-2000) }));
    }
  }

  /**
   * Company suggestions read the whole 40 MB index, so answers are kept per request body until the
   * index, directory, resume, config (your companies and muted ones) or the day changes: in memory,
   * and on disk so the first visit after a restart doesn't wait. Identical requests in flight share
   * one run. (The CLI keeps its slow step on disk too, for bodies not seen before.)
   */
  /** Bump when the answer's shape changes, so answers saved by an older version aren't served (2: `added`). */
  const ANSWER_FORMAT = 2;
  /** In the suggestions cache: the inputs the last background ranking read. */
  const WARM_FILE = "warm.json";
  const suggestCache = new Map<string, Promise<string>>();
  /**
   * Suggestion runs one at a time: a page request that comes while the background run ranks
   * companies waits for it and then reads its ranking, instead of doing the same work alongside.
   */
  let suggestRuns: Promise<unknown> = Promise.resolve();
  function oneSuggestRun<T>(run: () => Promise<T>): Promise<T> {
    const next = suggestRuns.then(run, run);
    suggestRuns = next.catch(() => {});
    return next;
  }
  /** A saved answer (written whole by writeCacheFile), or undefined. */
  const readSaved = (file: string) => {
    try {
      const text = readFileSync(file, "utf8");
      return text.startsWith("{") ? text : undefined;
    } catch {
      return undefined;
    }
  };
  /**
   * The parts of the config an answer depends on: your companies and muted ones (left out), and the
   * profile when the request doesn't send one. Saving other settings doesn't change it. Read again
   * only when the file changes; one that doesn't load counts by its file stamp.
   */
  let configPart: { stamp: string; part: string } | undefined;
  function configKey(): string {
    const files = CONFIG_CANDIDATES.map((f) => resolve(home, f));
    const stamp = files.map(fileStamp).join(":");
    if (configPart?.stamp !== stamp) {
      let part = stamp;
      try {
        const { config } = loadConfig(findConfigPath(home));
        part = JSON.stringify([config.companies.map(companyKey), config.companies_muted ?? [], config.companies_replaced ?? [], config.profile]);
      } catch {
        // No config yet, or one that doesn't load: its stamp.
      }
      configPart = { stamp, part };
    }
    return configPart.part;
  }

  /** What a ranking reads: the code, the day, the index, directory, your additions, resume and config. */
  function suggestStamp(): string {
    const inputs = [...["index.json", "directory.json", "additions.json"].map((f) => resolve(dataDir, "catalog", f)), resolve(home, "profile/resume.md")];
    return [ANSWER_FORMAT, codeStamp(), new Date().toISOString().slice(0, 10), ...inputs.map(fileStamp), configKey()].join("|");
  }

  function suggestions(body: string): Promise<string> {
    const key = `${suggestStamp()}|${body}`;
    let hit = suggestCache.get(key);
    if (!hit) {
      const dir = suggestCacheDir(dataDir);
      const file = resolve(dir, `answer-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
      const saved = readSaved(file);
      hit = saved
        ? Promise.resolve(saved)
        : oneSuggestRun(() => collect(["companies", "suggest", "--json", "--stdin", "--data", dataDir], body)).then((r) => {
            const out = r.stdout.trim();
            if (!out.startsWith("{")) throw new Error((r.stderr || "suggestions failed").trim().slice(-1500));
            writeCacheFile(dir, file, out);
            pruneCache(dir, "answer-");
            return out;
          });
      hit.catch(() => suggestCache.delete(key));
      suggestCache.set(key, hit);
      // Keep the last few profiles only.
      for (const k of [...suggestCache.keys()].slice(0, -6)) suggestCache.delete(k);
    }
    return hit;
  }

  /** How many companies a suggestion request checks, kept until the index or directory changes. */
  let poolSize: { stamp: string; companies: number | null } | undefined;
  function suggestSize(): number | null {
    const stamp = ["catalog/index.json", "catalog/directory.json", "catalog/additions.json"]
      .map((f) => {
        try {
          return statSync(resolve(dataDir, f)).mtimeMs;
        } catch {
          return 0;
        }
      })
      .join(":");
    if (poolSize?.stamp !== stamp) poolSize = { stamp, companies: suggestPoolSize(dataDir) };
    return poolSize.companies;
  }

  // ---------- the running scan ----------
  /** The scan the server is running: its scope, its lines so far (bounded: scanLines), and the tabs following it. */
  let scan: { scope: string; lines: ScanLines; partial: string; followers: Set<ServerResponse>; child: ChildProcess; background?: boolean } | null = null;
  /** "Check now" runs: they share the one-at-a-time rule with scans. */
  let checking = false;
  /**
   * Another process's scan: a scheduled one, or `rawjobs scan` in a terminal. It holds the lock, and
   * its live file says who started it (an older CLI writes none: counted as scheduled).
   */
  function otherScan(): { pid: number; origin: ScanOrigin; scope: ScanScope } | null {
    if (scan) return null;
    const pid = scanLockHolder(dataDir);
    if (pid === undefined) return null;
    const head = readLiveHead(dataDir);
    return head?.pid === pid ? { pid, origin: head.origin, scope: head.scope } : { pid, origin: "scheduled", scope: "mine" };
  }
  /** Any scan or "Check now" running, this server's or another process's: one at a time. */
  const busy = () => scan !== null || checking || scanLockHeld(dataDir);

  /** meta.json's generatedAt, read again only when the file changes (open pages ask every few seconds). It's
   *  the file's second key, so its first 4 KB are enough; the whole file is parsed only when it isn't there. */
  let meta: { stamp: string; generatedAt: string | null } | null = null;
  function dataVersion(): string | null {
    const path = resolve(dataDir, "meta.json");
    try {
      const { mtimeMs, size } = statSync(path);
      const stamp = `${mtimeMs}:${size}`;
      if (meta?.stamp !== stamp) {
        const head = /"generatedAt"\s*:\s*"([^"]+)"/.exec(readHead(path, 4096));
        const generatedAt = head ? head[1] : (JSON.parse(readFileSync(path, "utf8")) as { generatedAt?: unknown }).generatedAt;
        meta = { stamp, generatedAt: typeof generatedAt === "string" ? generatedAt : null };
      }
      return meta.generatedAt;
    } catch {
      // No scan yet: nothing to show.
      meta = null;
      return null;
    }
  }

  /** tracking.json's rev, read again only when the file changes: open pages pull another window's
   *  saves when it moves. It's in the file's first bytes. */
  let trackingStamp: { stamp: string; rev: number } | null = null;
  function trackingRev(): number {
    const path = resolve(home, TRACKING_PATH);
    try {
      // Every save is a new file moved into place, so its ino changes even when size and time match.
      const { mtimeMs, size, ino } = statSync(path);
      const stamp = `${mtimeMs}:${size}:${ino}`;
      if (trackingStamp?.stamp !== stamp) trackingStamp = { stamp, rev: trackingRevFromHead(readHead(path, 256)) };
      return trackingStamp.rev;
    } catch {
      // Nothing saved yet (or locked for a moment): rev 0 until it can be read.
      trackingStamp = null;
      return 0;
    }
  }

  function follow(res: ServerResponse) {
    if (!scan) return;
    res.setHeader("content-type", "application/x-ndjson");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("x-rawjobs-scope", scan.scope);
    for (const line of scan.lines.replay()) res.write(`${line}\n`);
    scan.followers.add(res);
    const current = scan;
    // A tab that goes away just stops following; the scan carries on.
    res.on("close", () => current.followers.delete(res));
  }

  /**
   * Follow another process's scan through its live file: what it wrote so far, then each new line (read
   * every second) until it lets go of the lock. Without a live file (an older CLI) there's nothing to show.
   */
  function followOther(res: ServerResponse, other: { pid: number; origin: ScanOrigin; scope: ScanScope }) {
    const path = resolve(dataDir, LIVE_FILE);
    if (readLiveHead(dataDir)?.pid !== other.pid) {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/x-ndjson");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("x-rawjobs-scope", other.scope);
    res.setHeader("x-rawjobs-origin", other.origin);
    let offset = 0;
    let partial = "";
    let head = true;
    const pump = () => {
      let fd: number | undefined;
      try {
        fd = openSync(path, "r");
        const size = fstatSync(fd).size;
        if (size <= offset) return;
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        offset = size;
        const lines = (partial + buf.toString("utf8")).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          // Line 1 is the head (who started it), not an event.
          if (head) head = false;
          else if (line.trim() && !res.writableEnded) res.write(`${line}\n`);
        }
      } catch {
        // The file went (a new scan starting it over): what was sent stays.
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    };
    pump();
    const timer = setInterval(() => {
      pump();
      if (scanLockHolder(dataDir) === other.pid) return;
      clearInterval(timer);
      // It wrote new results and its run log: answers kept from before it ended are out of date.
      readers.clear();
      res.end();
    }, 1000);
    // A tab that goes away just stops following; the scan carries on.
    res.on("close", () => clearInterval(timer));
  }

  function broadcast(line: Line) {
    if (!scan) return;
    // Scan now is done: what runs from here is the quiet background check, which a new scan may stop.
    if (line.startsWith('{"type":"background"')) scan.background = true;
    scan.lines.push(line);
    for (const res of scan.followers) if (!res.writableEnded) res.write(`${line}\n`);
  }

  function startScan(scope: ScanScope, fresh: boolean, backgroundOnly = false) {
    // "Check every company now" fetches every company live: the job feed doesn't pick for it.
    const child = backgroundOnly
      ? cli(["scan", "--progress", "ndjson", "--background-only", "--data", dataDir])
      : cli(["scan", "--progress", "ndjson", "--scope", scope, ...(fresh ? ["--fresh"] : []), ...(scope === "all" ? ["--full"] : []), "--data", dataDir]);
    scan = { scope, lines: scanLines(), partial: "", followers: new Set(), child, ...(backgroundOnly ? { background: true } : {}) };
    const current = scan;
    let stderr = "";
    // Always read the scan's output, whether or not a tab is listening: an unread pipe fills up
    // and would block the scan.
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      const parts = (current.partial + d).split("\n");
      current.partial = parts.pop() ?? "";
      for (const p of parts) if (p.trim()) broadcast(p);
    });
    child.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const finish = (code: number | null, err?: Error) => {
      if (scan !== current) return;
      if (current.partial.trim()) broadcast(current.partial);
      if (err) broadcast(JSON.stringify({ type: "error", message: String(err) }));
      else if (code !== 0 && stderr) broadcast(JSON.stringify({ type: "error", message: stderr.trim().slice(-1500) }));
      for (const res of current.followers) res.end();
      scan = null;
      readers.clear();
    };
    child.on("error", (err) => finish(1, err));
    child.on("close", (code) => finish(code));
  }

  /**
   * A route's JSON answer. `route` names it in ApiRoutes (@rawjobs/core/protocol), which the dashboard
   * reads it by: what it answers when it works, or its ApiFailure for an error status.
   */
  function send<R extends ApiRoute>(res: ServerResponse, _route: R, body: ApiRoutes[R] | ApiFailure<R>, status = 200) {
    writeJson(res, body, status);
  }
  /** An error any route may answer: { ok: false, errors } (refused, failed, a body that isn't JSON). */
  function fail(res: ServerResponse, errors: string, status: number) {
    writeJson(res, { ok: false, errors }, status);
  }

  /** Answer an /api request. Returns false when the URL isn't ours (let the caller serve it). */
  /** CSP reports already logged this start. */
  const cspSeen = new Set<string>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/")) return false;
    if (url === "/api/network" || url.startsWith("/api/network/")) {
      // Your connections: never cached, sniffed or read by another site's page.
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("cross-origin-resource-policy", "same-origin");
    }
    if (url === CSP_REPORT_PATH && req.method === "POST") {
      // What the Content-Security-Policy blocked: one log line per kind, at
      // most 50 a start. The browser sends these on its own, sometimes without an Origin, so only the
      // Host is checked; the route changes nothing.
      if (!refuseHost(req)) {
        const line = cspReportLine(await readBody(req, 64_000).catch(() => ""));
        if (line && !cspSeen.has(line) && cspSeen.size < 50) {
          cspSeen.add(line);
          console.warn(`RawJobs: ${line}`);
        }
      }
      res.statusCode = 204;
      res.end();
      return true;
    }
    const why = refuse(req);
    if (why) fail(res, why, 403);
    else {
      const writes = req.method !== "GET" && WRITES.test(url) && !READ_POSTS.has(url);
      if (writes) readers.clear();
      try {
        await route(url, req, res);
      } catch (err) {
        // Into logs/server.log, so a failure the dashboard only shows as "500" can be looked into.
        console.error(`${req.method} ${url} failed:`, err);
        if (!res.headersSent) fail(res, String(err), 500);
        else res.end();
      } finally {
        // Again once it's done: a read while it ran may have kept what it changed.
        if (writes) readers.clear();
      }
    }
    return true;
  }

  async function route(url: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (url === "/api/health" && req.method === "GET") {
      // A dashboard left open on another port of this computer (RawJobs moved to the next port) may
      // read it, to find RawJobs here and go to it. Only this computer's own addresses.
      const origin = req.headers.origin;
      if (origin && LOCAL_ORIGIN.test(origin)) res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      return send(res, "GET /api/health", {
        ok: true,
        version,
        scanning: scan !== null || checking,
        background: scan === null && scanLockHeld(dataDir),
        scanOrigin: scan ? "page" : (otherScan()?.origin ?? null),
        dataVersion: dataVersion(),
        trackingRev: trackingRev(),
        update: opts.updater?.updateHint() ?? null,
        startLink: opts.startLink?.() ?? false,
        safeMode: opts.safeMode?.() ?? false,
        platform: process.platform,
        // Which RawJobs folder this server is for (an id, not the path) and its process: an update
        // stops every server of its folder before it starts the new version.
        home: folderId(opts.home),
        pid: process.pid,
      });
    }
    if (url === "/api/update" || url.startsWith("/api/update/")) {
      if (opts.updater && (await opts.updater.route(url, req, res, () => readBody(req)))) return;
      if (url === "/api/update" && req.method === "GET")
        return send(res, "GET /api/update", { installed: false, current: version, lastUpdate: null, available: null, tooOld: false, state: "idle", settings: { mode: "off", channel: "stable" } });
      return fail(res, "This copy updates with git (git pull), not by itself.", 400);
    }
    if (url === "/api/tracking" && req.method === "GET") {
      let doc: TrackingDoc | null;
      try {
        doc = readTrackingStrict(home).doc;
      } catch (err) {
        // 503, not "nothing saved": the page then keeps its own copy instead of uploading it over the file.
        if (err instanceof TrackingUnreadable) return send(res, "GET /api/tracking", { ok: false, errors: "Couldn't read your tracking file. Try again in a moment." }, 503);
        throw err;
      }
      const rev = doc?.rev ?? 0;
      const epoch = doc?.epoch ?? "";
      res.setHeader("etag", trackingTag(epoch, rev));
      return send(res, "GET /api/tracking", { tracking: doc?.tracking ?? null, rev, epoch });
    }
    if (url === "/api/tracking" && (req.method === "PUT" || req.method === "PATCH")) {
      // PATCH: key-level changes on top of what the page last saw (If-Match "<epoch>:<rev>").
      // PUT: whole parts, from pages cached before PATCH existed.
      const base = req.method === "PATCH" ? parseTrackingTag(req.headers["if-match"]) : null;
      if (req.method === "PATCH" && !base) return send(res, "PATCH /api/tracking", { ok: false, errors: 'Send If-Match: "<epoch>:<rev>" from the last GET.' }, 400);
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, 20_000_000));
      } catch (err) {
        return fail(res, (err as Error).message, 400);
      }
      if (base) {
        const r = patchTracking(body, base, home);
        if (r.ok) return send(res, "PATCH /api/tracking", r);
        if (r.status === 409) return send(res, "PATCH /api/tracking", { ok: false, rev: r.rev, epoch: r.epoch, tracking: r.tracking, conflicts: r.conflicts }, 409);
        return send(res, "PATCH /api/tracking", { ok: false, errors: r.error }, r.status);
      }
      const r = saveTracking(body, home);
      return r.ok ? send(res, "PUT /api/tracking", { ok: true, updatedAt: r.tracking.updatedAt, rev: r.rev, epoch: r.epoch }) : fail(res, r.error, r.status);
    }
    if (url === "/api/network" || url.startsWith("/api/network/")) return await networkRoute(url, req, res);
    if (url === "/api/setup" && req.method === "GET") return await respondRead(res, "GET /api/setup", () => readers.memo("setup", 10_000, () => setupStatus(home, dataDir)));
    if (url === "/api/setup/config" && req.method === "POST") return await respondJson(res, "POST /api/setup/config", ["setup", "save"], await readBody(req));
    if (url === "/api/setup/reset" && req.method === "POST") {
      if (busy()) return send(res, "POST /api/setup/reset", { ok: false, errors: "A scan is running; try again when it's done." });
      // Starting over also deletes your LinkedIn connections.
      watcher.stop();
      reminder.clear();
      await network.remove();
      return await respondJson(res, "POST /api/setup/reset", ["setup", "reset"]);
    }
    if (url === "/api/setup/resume" && req.method === "GET") return await respondRead(res, "GET /api/setup/resume", () => readResume(home));
    if (url === "/api/setup/resume" && req.method === "POST") return await respondJson(res, "POST /api/setup/resume", ["setup", "resume", "save"], await readBody(req));
    if (url === "/api/setup/resume" && req.method === "DELETE") return await respondJson(res, "DELETE /api/setup/resume", ["setup", "resume", "delete"]);
    if (url === "/api/setup/check" && req.method === "POST") return await respondJson(res, "POST /api/setup/check", ["setup", "check", "--data", dataDir], await readBody(req));
    if (url === "/api/directory" && req.method === "GET") {
      // Kept while the local copy's files stay the same (an hour at most: it says how old it is).
      const stamp = ["manifest.json", "outbox.json", "moves-outbox.json", "directory.json"].map((f) => fileStamp(resolve(dataDir, "catalog", f))).join("|");
      return await respondRead(res, "GET /api/directory", () => readCli("GET /api/directory", `directory|${stamp}`, HOUR_MS, ["directory", "status", "--json", "--data", dataDir]));
    }
    if (url === "/api/directory/search" && req.method === "POST") return await searchRoute(res, req, "POST /api/directory/search", "search");
    if (url === "/api/directory/names" && req.method === "POST") return await searchRoute(res, req, "POST /api/directory/names", "names");
    if (url === "/api/directory/warm" && req.method === "POST") return await searchRoute(res, req, "POST /api/directory/warm", "warm");
    if (url === "/api/directory/update" && req.method === "POST")
      return respondOutput(res, "POST /api/directory/update", await updateDirectoryOnce(["directory", "update", "--json", "--data", dataDir]));
    if (url === "/api/directory/moves" && req.method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 10_000)) || "null");
      } catch (err) {
        return fail(res, (err as Error).message, 400);
      }
      const move = cleanMove(body);
      if (typeof move === "string") return fail(res, move, 400);
      const sharingOn = (() => {
        try {
          return loadConfig(findConfigPath(home)).config.directory.share_additions !== false;
        } catch {
          return true;
        }
      })();
      if (!sharingOn) return send(res, "POST /api/directory/moves", { queued: false, reason: "Sharing is off in your settings." });
      if (!contributeUrl()) return send(res, "POST /api/directory/moves", { queued: false, reason: "Sharing isn't set up for this install." });
      queueMove(dataDir, move);
      return send(res, "POST /api/directory/moves", { queued: true });
    }
    if (url === "/api/companies/suggest/size" && req.method === "GET") return send(res, "GET /api/companies/suggest/size", { companies: suggestSize() });
    if (url === "/api/companies/suggest" && req.method === "POST") {
      try {
        res.setHeader("content-type", "application/json");
        res.end(await suggestions(await readBody(req)));
      } catch (err) {
        fail(res, (err as Error).message, 500);
      }
      return;
    }
    // In the few seconds RawJobs restarts into a new version, nothing new starts.
    if (opts.updater?.updating() && ((url === "/api/run" && req.method === "POST") || url === "/api/check" || url === "/api/schedule/run")) {
      const message = "RawJobs is updating; try again in a few seconds.";
      const busyBody = { ok: false as const, type: "error" as const, errors: message, message };
      if (url === "/api/check") return send(res, "POST /api/check", busyBody, 503);
      if (url === "/api/schedule/run") return send(res, "POST /api/schedule/run", busyBody, 503);
      res.setHeader("content-type", "application/x-ndjson");
      res.end(`${JSON.stringify({ type: "error", message })}
`);
      return;
    }
    if (url === "/api/check" && req.method === "POST") {
      // "Check now" on a directory job: fetch just that company, answer with the final event.
      const keys = ((JSON.parse((await readBody(req)) || "{}") as { keys?: unknown }).keys ?? []) as unknown[];
      const valid = keys.filter((k): k is string => typeof k === "string" && /^[a-z]+:[^\s]+$/i.test(k)).slice(0, 5);
      if (!valid.length) return send(res, "POST /api/check", { type: "error", message: "No company to check." }, 400);
      if (busy()) return send(res, "POST /api/check", { type: "error", message: "A scan is running; try again when it's done." });
      checking = true;
      try {
        const r = await collect(["run", "--progress", "ndjson", "--data", dataDir, ...valid.flatMap((k) => ["--check", k])], undefined, 180_000);
        const last = r.stdout.trim().split("\n").pop() ?? "";
        res.setHeader("content-type", "application/json");
        res.end(last.startsWith("{") ? last : JSON.stringify({ type: "error", message: (r.stderr || "check failed").trim().slice(-500) }));
      } finally {
        checking = false;
        readers.clear();
      }
      return;
    }
    if (url === "/api/scan/plan" && req.method === "GET")
      return await respondRead(res, "GET /api/scan/plan", () => readCli("GET /api/scan/plan", "plan", 30_000, ["scan", "--plan", "--data", dataDir]));
    if (url === "/api/alerts/telegram" && req.method === "GET") return await respondRead(res, "GET /api/alerts/telegram", () => readers.memo("telegram", 30_000, () => telegramStatus(home)));
    const alert = url.match(/^\/api\/alerts\/telegram\/(token|connect|test|on|off|forget)$/);
    if (alert && req.method === "POST") return await respondJson(res, "POST /api/alerts/telegram/:action", ["alerts", "telegram", alert[1]!], await readBody(req));
    // Reading the scheduled tasks runs PowerShell on Windows: kept for 5 minutes.
    if (url === "/api/doctor" && req.method === "POST") {
      // A redacted diagnostics file in logs/, shown in the file manager. Nothing is uploaded.
      const r = await collect(["doctor", "--json", "--zip", "--data", dataDir], undefined, 120_000);
      try {
        const out = JSON.parse(r.stdout.trim()) as { zip?: string };
        if (out.zip) opts.reveal?.(out.zip);
      } catch {
        // respondOutput says what went wrong
      }
      return respondOutput(res, "POST /api/doctor", r);
    }
    if (url === "/api/schedule" && req.method === "GET")
      return await respondRead(res, "GET /api/schedule", () => readCli("GET /api/schedule", "schedule", 5 * 60_000, ["schedule", "status", "--data", dataDir]));
    if (url === "/api/schedule" && req.method === "POST") return await respondJson(res, "POST /api/schedule", ["schedule", "install", "--stdin", "--data", dataDir], await readBody(req));
    if (url === "/api/schedule" && req.method === "DELETE") return await respondJson(res, "DELETE /api/schedule", ["schedule", "remove", "--data", dataDir]);
    if (url === "/api/schedule/run" && req.method === "POST") {
      // Started now, it would find this scan running and log a failed run.
      if (busy()) return send(res, "POST /api/schedule/run", { ok: false, errors: "A scan is running; try again when it's done." });
      return await respondJson(res, "POST /api/schedule/run", ["schedule", "run", "--data", dataDir]);
    }
    if (url === "/api/daily-summary" && req.method === "GET")
      return await respondRead(res, "GET /api/daily-summary", () => readCli("GET /api/daily-summary", "daily", 5 * 60_000, ["today", "status", "--data", dataDir]));
    if (url === "/api/daily-summary" && req.method === "POST") return await respondJson(res, "POST /api/daily-summary", ["today", "install", "--stdin", "--data", dataDir], await readBody(req));
    if (url === "/api/daily-summary" && req.method === "DELETE") return await respondJson(res, "DELETE /api/daily-summary", ["today", "remove", "--data", dataDir]);
    if (url === "/api/daily-summary/test" && req.method === "POST") return await respondJson(res, "POST /api/daily-summary/test", ["today", "--test", "--json", "--data", dataDir]);
    if (url === "/api/run/notify" && req.method === "POST") {
      // The running scan sends a Telegram message when it finishes (it checks for this file at the end).
      // Any scan holding the lock: this server's, a scheduled one or a terminal's.
      const any = scan !== null || otherScan() !== null;
      if (any) writeFileSync(resolve(dataDir, "scan-notify"), "");
      return send(res, "POST /api/run/notify", { ok: any });
    }
    if (url === "/api/run/stop" && req.method === "POST") {
      // The scan checks for this file between companies, saves its progress and stops.
      // Any scan holding the lock: this server's, a scheduled one or a terminal's.
      const any = scan !== null || otherScan() !== null;
      if (any) writeFileSync(resolve(dataDir, "scan-stop"), "");
      return send(res, "POST /api/run/stop", { ok: any });
    }
    if (url === "/api/run" && req.method === "GET") {
      if (scan) follow(res);
      else {
        const other = otherScan();
        if (other) followOther(res, other);
        else {
          res.statusCode = 204;
          res.end();
        }
      }
      return;
    }
    if (url === "/api/run" && req.method === "POST") {
      // The background check gives way: stopped (its progress is saved), it carries on after this scan.
      const current = scan;
      if (current?.background && !checking) {
        const closed = new Promise<void>((done) => (current.child.exitCode !== null ? done() : current.child.once("close", () => done())));
        writeFileSync(resolve(dataDir, "scan-stop"), "");
        await Promise.race([closed, new Promise((done) => setTimeout(done, 60_000))]);
      }
      // So does another process's scan in its background check (the next one carries it on).
      const other = otherScan();
      if (other && !checking && liveInBackground(dataDir)) {
        writeFileSync(resolve(dataDir, "scan-stop"), "");
        for (let waited = 0; waited < 60_000 && scanLockHolder(dataDir) === other.pid; waited += 500) await new Promise((done) => setTimeout(done, 500));
      }
      if (busy()) {
        const running = otherScan();
        res.setHeader("content-type", "application/x-ndjson");
        res.end(
          `${JSON.stringify({ type: "error", message: running ? `A ${running.origin === "terminal" ? "scan started in a terminal" : "scheduled scan"} is running. Follow it from the scan button; its new jobs show up when it's done.` : "A scan is already running." })}\n`,
        );
        return;
      }
      const body = (JSON.parse((await readBody(req)) || "{}") ?? {}) as { scope?: unknown; fresh?: unknown; background?: unknown };
      startScan(body.scope === "all" || body.scope === "yours" ? body.scope : "mine", body.fresh === true, body.background === true);
      follow(res);
      return;
    }
    res.statusCode = 404;
    res.end();
  }

  /** Keep the shared company directory fresh: a weekly check in the background, off if you turned it off. */
  /**
   * Once the directory is up to date, rank companies for the saved profile in the background, so
   * the Companies page's first visit reads the ranking from disk instead of waiting for it.
   */
  function startBackground() {
    // A Downloads watch from before a restart carries on.
    watcher.resume();
    // A LinkedIn file reminder whose time came while RawJobs was off fires now.
    reminder.resume();
    void updateDirectoryOnce(["directory", "update", "--auto", "--if-older", "7", "--data", dataDir]).then(() => warmSuggestions());
  }

  /**
   * Rank companies for the saved profile, unless the last background ranking read the same inputs
   * (suggestStamp): a restart with nothing new doesn't read the 40 MB index again.
   */
  function warmSuggestions() {
    const dir = suggestCacheDir(dataDir);
    const file = resolve(dir, WARM_FILE);
    const stamp = suggestStamp();
    if (readSaved(file) === JSON.stringify({ stamp })) return Promise.resolve();
    return oneSuggestRun(() => collect(["companies", "suggest", "--json", "--data", dataDir])).then((r) => {
      if (r.code === 0 && r.stdout.trim().startsWith("{")) writeCacheFile(dir, file, JSON.stringify({ stamp }));
    });
  }

  /**
   * One directory update from this server at a time: the weekly check at start and the Update button
   * (or two clicks of it) share the run that's going. It may take as long as a download may (a slow
   * link), so it isn't stopped after the usual 10 minutes, mid-download or mid-swap.
   */
  let directoryUpdate: { key: string; run: Promise<{ code: number; stdout: string; stderr: string }> } | null = null;
  function updateDirectoryOnce(args: string[]) {
    const key = args.join(" ");
    if (directoryUpdate?.key === key) return directoryUpdate.run;
    // A different one (the button while the weekly check runs): after it, so they never overlap.
    const before = directoryUpdate?.run ?? Promise.resolve();
    const run = before.then(() => collect(args, undefined, MAX_DOWNLOAD_MS + 2 * 60_000));
    const entry = { key, run };
    directoryUpdate = entry;
    void run.finally(() => {
      if (directoryUpdate === entry) directoryUpdate = null;
    });
    return run;
  }

  /** /api/network*: your LinkedIn connections. Error answers never repeat the company asked about. */
  async function networkRoute(url: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const bad = (code: string, status = 400) => writeJson(res, { ok: false, errors: [{ code }] } satisfies NetworkError, status);
    if (url === "/api/network" && req.method === "GET") {
      const watchable = watcher.supported();
      return send(res, "GET /api/network", { status: { ...network.status(), watch: watcher.state() }, me: network.me(), watchable, reminder: reminder.state() });
    }
    if (url === "/api/network/watch" && req.method === "POST") {
      let body: { hours?: unknown };
      try {
        body = (JSON.parse((await readBody(req, 1_000)) || "{}") ?? {}) as typeof body;
      } catch {
        return bad("BAD_REQUEST");
      }
      const r = await watcher.start(typeof body.hours === "number" ? body.hours : undefined);
      return r.ok ? send(res, "POST /api/network/watch", { watch: r.watch }) : send(res, "POST /api/network/watch", { watch: null, error: r.code }, 400);
    }
    if (url === "/api/network/watch" && req.method === "DELETE") {
      watcher.stop();
      return send(res, "DELETE /api/network/watch", { ok: true });
    }
    if (url === "/api/network/reminder" && req.method === "POST") {
      let body: { hours?: unknown };
      try {
        body = (JSON.parse((await readBody(req, 1_000)) || "{}") ?? {}) as typeof body;
      } catch {
        return bad("BAD_REQUEST");
      }
      return send(res, "POST /api/network/reminder", { reminder: reminder.set(typeof body.hours === "number" ? body.hours : undefined) });
    }
    if (url === "/api/network/reminder" && req.method === "DELETE") {
      reminder.clear();
      return send(res, "DELETE /api/network/reminder", { ok: true });
    }
    if (url === "/api/network" && req.method === "DELETE") {
      watcher.stop();
      reminder.clear();
      await network.remove();
      return send(res, "DELETE /api/network", { ok: true });
    }
    if (url === "/api/network/summary" && req.method === "GET") {
      const summary = network.summary();
      if (summary.importedAt) {
        const tag = `"${summary.importedAt}"`;
        res.setHeader("etag", tag);
        if (req.headers["if-none-match"] === tag) {
          res.statusCode = 304;
          res.end();
          return;
        }
      }
      return send(res, "GET /api/network/summary", summary);
    }
    if (url === "/api/network/people" && req.method === "GET") {
      const company = new URL(req.url ?? "", "http://x").searchParams.get("company")?.trim() ?? "";
      if (!company || company.length > 200) return bad("BAD_REQUEST");
      return send(res, "GET /api/network/people", network.people(company));
    }
    if (url === "/api/network/import" && req.method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, IMPORT_MAX, true));
      } catch (err) {
        return (err as Error).message === TOO_LARGE ? bad("TOO_BIG", 413) : bad("BAD_REQUEST");
      }
      const b = (body ?? {}) as { fileName?: unknown; files?: unknown };
      const files = (typeof b.files === "object" && b.files !== null ? b.files : {}) as Record<string, unknown>;
      const text = (k: string) => (typeof files[k] === "string" ? (files[k] as string) : undefined);
      const r = await network.import(
        { connections: text("connections"), positions: text("positions"), education: text("education") },
        { source: "file", fileName: typeof b.fileName === "string" ? b.fileName : undefined },
      );
      if (!r.ok) return bad(r.code);
      // You chose the file yourself: no need to keep watching for it, or to be reminded.
      watcher.stop();
      reminder.clear();
      return send(res, "POST /api/network/import", { ...r, status: { ...r.status, watch: null } });
    }
    if (url === "/api/network/friends" && req.method === "PUT") {
      let body: { id?: unknown; friend?: unknown };
      try {
        body = (JSON.parse(await readBody(req, 10_000)) ?? {}) as typeof body;
      } catch {
        return bad("BAD_REQUEST");
      }
      if (typeof body.id !== "string" || !CONNECTION_ID.test(body.id) || typeof body.friend !== "boolean") return bad("BAD_REQUEST");
      return (await network.setFriend(body.id, body.friend)) ? send(res, "PUT /api/network/friends", { ok: true }) : bad("NOT_FOUND", 404);
    }
    return bad("NOT_FOUND", 404);
  }

  /**
   * Before the server exits (Ctrl+C, an update): ask a running scan to stop (it saves what it has,
   * and the next scan resumes), and end it if it hasn't after `graceMs`. Tabs following it are closed.
   */
  async function stop(graceMs = 10_000): Promise<void> {
    // The watch itself stays in network-watch.json, so the next start carries on with it.
    watcher.close();
    reminder.close();
    await search.stop();
    const current = scan;
    if (!current) return;
    const closed = new Promise<void>((done) => {
      if (current.child.exitCode !== null) done();
      else current.child.once("close", () => done());
    });
    writeFileSync(resolve(dataDir, "scan-stop"), "");
    const timer = setTimeout(() => current.child.kill(), graceMs);
    await closed;
    clearTimeout(timer);
    for (const res of current.followers) res.end();
  }

  /**
   * Pause the scan that's running if it's in its background check (this server's, a scheduled one's or a
   * terminal's): it saves what it did and the next scan carries it on. Returns whether it asked one to.
   */
  function pauseBackground(): boolean {
    const inBackground = scan ? !!scan.background : otherScan() !== null && liveInBackground(dataDir);
    if (inBackground) writeFileSync(resolve(dataDir, "scan-stop"), "");
    return inBackground;
  }

  return { handle, startBackground, version, scanning: busy, cli: collect, stop, pauseBackground };
}

function writeJson(res: ServerResponse, body: unknown, status: number) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/** The largest LinkedIn import body: the three CSV texts. */
const IMPORT_MAX = 12_000_000;
const TOO_LARGE = "Request too large.";

/**
 * The request body as text, failing past `maxBytes`. The connection is cut there, unless `answer` is
 * set: then the rest is read and dropped and it fails at the end, so the route can still answer (413).
 */
function readBody(req: IncomingMessage, maxBytes = 5_000_000, answer = false): Promise<string> {
  return new Promise((done, fail) => {
    let body = "";
    let over = false;
    req.setEncoding("utf8");
    req.on("data", (d: string) => {
      if (over) return;
      body += d;
      if (body.length > maxBytes) {
        over = true;
        body = "";
        if (answer) return;
        fail(new Error(TOO_LARGE));
        req.destroy();
      }
    });
    req.on("end", () => (over ? fail(new Error(TOO_LARGE)) : done(body)));
    req.on("error", fail);
  });
}
