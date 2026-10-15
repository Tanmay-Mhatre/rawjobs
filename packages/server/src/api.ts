import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
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
  LEGACY_CONFIG_CANDIDATES,
  pruneCache,
  queueMove,
  scanLockHeld,
  suggestCacheDir,
  writeCacheFile,
} from "@rawjobs/core";
import { readTracking, saveTracking, suggestPoolSize, type ScanScope } from "@rawjobs/core";
import { refuse } from "./guard";
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
};

/** A page served from this computer (any port): may read /api/health from another port. */
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;

/** One line of the scan's NDJSON progress. */
type Line = string;

/**
 * The dashboard's API: everything it needs to set up and run RawJobs on this computer.
 *   GET  /api/health          { ok, version, scanning, background, dataVersion, update, startLink, platform }: is the server up,
 *                             which version, one waiting to install, and (for the page to remember while it's down) how to
 *                             start it again. background: a scan this server didn't start (a scheduled one) is running.
 *                             dataVersion: meta.json's generatedAt, so an open page sees when a scan wrote new results
 *   GET/PUT /api/tracking     your statuses, notes and Radar preferences (profile/tracking.json)
 *   GET  /api/update          an installed copy's updates (POST …/check, …/apply, …/seen; PUT …/settings)
 *   GET  /api/setup           setup status (+ current config)
 *   POST /api/setup/config    validate and save rawjobs.config.local.yaml
 *   POST /api/setup/reset     start setup over: move the config to rawjobs.config.local.backup.yaml
 *   POST /api/setup/check     detect + live-check careers URLs
 *   GET/POST/DELETE /api/setup/resume  read / save / remove the master resume (profile/resume.md, gitignored)
 *   GET  /api/directory       the shared company directory's local copy (and what's waiting to be shared)
 *   POST /api/directory/update download the latest shared directory and share waiting additions (and careers-link moves)
 *   POST /api/directory/moves  { name, from, to }: queue a confirmed careers-link move to share with the next directory
 *                             update (never sent right away). { queued: true }, { queued: false, reason } when sharing
 *                             is off, or 400 { ok: false, errors } for a body that isn't a move
 *   POST /api/companies/suggest  companies that fit a profile ({ profile?, watched?, hidden? }), with lookalikes of past employers
 *   GET  /api/companies/suggest/size  { companies }: how many companies a suggestion request checks (null when unknown)
 *   POST /api/run             scan ({ scope: "mine" | "yours" | "all", fresh? }); streams NDJSON progress. A background
 *                             check (after Scan now) is stopped first: it carries on after the new scan
 *   GET  /api/run             follow the running scan from the start (204 when none is running)
 *   POST /api/run/stop        stop the running scan after the companies in progress (it can be resumed)
 *   POST /api/run/notify      send a Telegram message when the running scan finishes
 *   GET  /api/scan/plan       what each scan type covers: companies, about how long, a stopped scan to resume
 *   GET  /api/alerts/telegram Telegram alerts: set up? on? (the token is never sent back, only masked)
 *   POST /api/alerts/telegram/{token|connect|test|on|off|forget}   set up and manage Telegram alerts
 *   GET/POST/DELETE /api/schedule   scheduled scans on this computer: status, install ({ times, scope }), remove
 *   POST /api/schedule/run    run the scheduled scan now
 *   POST /api/check           check directory companies now ({ keys: ["ats:slug"] }); answers with the done event
 * A scan belongs to the server, not to the tab that started it: closing or reloading the tab
 * never stops it, and GET /api/run picks it up again.
 */
export function createApi(opts: ApiOptions) {
  const { home, dataDir } = opts;
  const cliCmd = opts.cli ?? cliCommand();
  const version = opts.version ?? APP_VERSION;

  /** Run `rawjobs <args>` from the repo root (no shell, so no quoting issues). */
  function cli(args: string[], stdin?: string): ChildProcess {
    // Room for the job feed (a few hundred MB at peak) without letting a runaway scan take the laptop.
    const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=2048`.trim() };
    const child = spawn(cliCmd.command, [...cliCmd.args, ...args], { cwd: home, env, windowsHide: true });
    if (stdin !== undefined) child.stdin!.end(stdin);
    else child.stdin!.end();
    return child;
  }

  /**
   * Run the CLI and collect its output. A run that hangs (a stalled download, say) is stopped after
   * `timeoutMs`, so a request (and the "checking" flag it holds) can't wait forever.
   */
  function collect(args: string[], stdin?: string, timeoutMs = 600_000): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((done) => {
      const child = cli(args, stdin);
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        done({
          code: 1,
          stdout,
          stderr: `${stderr}
Stopped after ${Math.round(timeoutMs / 1000)} s without finishing.`.trim(),
        });
      }, timeoutMs);
      const finish = (r: { code: number; stdout: string; stderr: string }) => {
        clearTimeout(timer);
        done(r);
      };
      child.stdout!.on("data", (d) => (stdout += d));
      child.stderr!.on("data", (d) => (stderr += d));
      child.on("error", (err) => finish({ code: 1, stdout, stderr: String(err) }));
      child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
    });
  }

  /** Send the CLI's JSON stdout as the response, or a JSON error. */
  async function respondJson(res: ServerResponse, args: string[], stdin?: string) {
    const r = await collect(args, stdin);
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
    const files = [...CONFIG_CANDIDATES, ...LEGACY_CONFIG_CANDIDATES].map((f) => resolve(home, f));
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

  function suggestions(body: string): Promise<string> {
    const inputs = [...["index.json", "directory.json", "additions.json"].map((f) => resolve(dataDir, "catalog", f)), resolve(home, "profile/resume.md")];
    const stamp = [ANSWER_FORMAT, codeStamp(), new Date().toISOString().slice(0, 10), ...inputs.map(fileStamp), configKey()].join("|");
    const key = `${stamp}|${body}`;
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
  /** The scan the server is running: its scope, every progress line so far, and the tabs following it. */
  let scan: { scope: string; lines: Line[]; partial: string; followers: Set<ServerResponse>; child: ChildProcess; background?: boolean } | null = null;
  /** "Check now" runs: they share the one-at-a-time rule with scans. */
  let checking = false;
  const busy = () => scan !== null || checking;

  /** meta.json's generatedAt, read again only when the file changes (open pages ask every few seconds). */
  let meta: { stamp: string; generatedAt: string | null } | null = null;
  function dataVersion(): string | null {
    const path = resolve(dataDir, "meta.json");
    try {
      const { mtimeMs, size } = statSync(path);
      const stamp = `${mtimeMs}:${size}`;
      if (meta?.stamp !== stamp) {
        const { generatedAt } = JSON.parse(readFileSync(path, "utf8")) as { generatedAt?: unknown };
        meta = { stamp, generatedAt: typeof generatedAt === "string" ? generatedAt : null };
      }
      return meta.generatedAt;
    } catch {
      // No scan yet: nothing to show.
      meta = null;
      return null;
    }
  }

  function follow(res: ServerResponse) {
    if (!scan) return;
    res.setHeader("content-type", "application/x-ndjson");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("x-rawjobs-scope", scan.scope);
    for (const line of scan.lines) res.write(`${line}\n`);
    scan.followers.add(res);
    const current = scan;
    // A tab that goes away just stops following; the scan carries on.
    res.on("close", () => current.followers.delete(res));
  }

  function broadcast(line: Line) {
    if (!scan) return;
    // Scan now is done: what runs from here is the quiet background check, which a new scan may stop.
    if (line.startsWith('{"type":"background"')) scan.background = true;
    scan.lines.push(line);
    for (const res of scan.followers) if (!res.writableEnded) res.write(`${line}\n`);
  }

  function startScan(scope: ScanScope, fresh: boolean) {
    // "Check every company now" fetches every company live: the job feed doesn't pick for it.
    const child = cli(["scan", "--progress", "ndjson", "--scope", scope, ...(fresh ? ["--fresh"] : []), ...(scope === "all" ? ["--full"] : []), "--data", dataDir]);
    scan = { scope, lines: [], partial: "", followers: new Set(), child };
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
    };
    child.on("error", (err) => finish(1, err));
    child.on("close", (code) => finish(code));
  }

  function json(res: ServerResponse, body: unknown, status = 200) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  }

  /** Answer an /api request. Returns false when the URL isn't ours (let the caller serve it). */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/")) return false;
    const why = refuse(req);
    if (why) json(res, { ok: false, errors: why }, 403);
    else {
      try {
        await route(url, req, res);
      } catch (err) {
        // Into logs/server.log, so a failure the dashboard only shows as "500" can be looked into.
        console.error(`${req.method} ${url} failed:`, err);
        if (!res.headersSent) json(res, { ok: false, errors: String(err) }, 500);
        else res.end();
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
      return json(res, {
        ok: true,
        version,
        scanning: busy(),
        background: scan === null && scanLockHeld(dataDir),
        dataVersion: dataVersion(),
        update: opts.updater?.updateHint() ?? null,
        startLink: opts.startLink?.() ?? false,
        platform: process.platform,
      });
    }
    if (url === "/api/update" || url.startsWith("/api/update/")) {
      if (opts.updater && (await opts.updater.route(url, req, res, () => readBody(req)))) return;
      if (url === "/api/update" && req.method === "GET")
        return json(res, { installed: false, current: version, lastUpdate: null, available: null, tooOld: false, state: "idle", settings: { mode: "off", channel: "stable" } });
      return json(res, { ok: false, errors: "This copy updates with git (git pull), not by itself." }, 400);
    }
    if (url === "/api/tracking" && req.method === "GET") return json(res, { tracking: readTracking(home) });
    if (url === "/api/tracking" && req.method === "PUT") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, 20_000_000));
      } catch (err) {
        return json(res, { ok: false, errors: (err as Error).message }, 400);
      }
      const r = saveTracking(body, home);
      return r.ok ? json(res, { ok: true, updatedAt: r.tracking.updatedAt }) : json(res, { ok: false, errors: r.error }, 400);
    }
    if (url === "/api/setup" && req.method === "GET") return await respondJson(res, ["setup", "status", "--data", dataDir]);
    if (url === "/api/setup/config" && req.method === "POST") return await respondJson(res, ["setup", "save"], await readBody(req));
    if (url === "/api/setup/reset" && req.method === "POST") {
      if (busy()) return json(res, { ok: false, errors: "A scan is running; try again when it's done." });
      return await respondJson(res, ["setup", "reset"]);
    }
    if (url === "/api/setup/resume" && req.method === "GET") return await respondJson(res, ["setup", "resume"]);
    if (url === "/api/setup/resume" && req.method === "POST") return await respondJson(res, ["setup", "resume", "save"], await readBody(req));
    if (url === "/api/setup/resume" && req.method === "DELETE") return await respondJson(res, ["setup", "resume", "delete"]);
    if (url === "/api/setup/check" && req.method === "POST") return await respondJson(res, ["setup", "check", "--data", dataDir], await readBody(req));
    if (url === "/api/directory" && req.method === "GET") return await respondJson(res, ["directory", "status", "--json", "--data", dataDir]);
    if (url === "/api/directory/update" && req.method === "POST") return await respondJson(res, ["directory", "update", "--json", "--data", dataDir]);
    if (url === "/api/directory/moves" && req.method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 10_000)) || "null");
      } catch (err) {
        return json(res, { ok: false, errors: (err as Error).message }, 400);
      }
      const move = cleanMove(body);
      if (typeof move === "string") return json(res, { ok: false, errors: move }, 400);
      const sharingOn = (() => {
        try {
          return loadConfig(findConfigPath(home)).config.directory.share_additions !== false;
        } catch {
          return true;
        }
      })();
      if (!sharingOn) return json(res, { queued: false, reason: "Sharing is off in your settings." });
      if (!contributeUrl()) return json(res, { queued: false, reason: "Sharing isn't set up for this install." });
      queueMove(dataDir, move);
      return json(res, { queued: true });
    }
    if (url === "/api/companies/suggest/size" && req.method === "GET") return json(res, { companies: suggestSize() });
    if (url === "/api/companies/suggest" && req.method === "POST") {
      try {
        res.setHeader("content-type", "application/json");
        res.end(await suggestions(await readBody(req)));
      } catch (err) {
        json(res, { ok: false, errors: (err as Error).message }, 500);
      }
      return;
    }
    // In the few seconds RawJobs restarts into a new version, nothing new starts.
    if (opts.updater?.updating() && ((url === "/api/run" && req.method === "POST") || url === "/api/check" || url === "/api/schedule/run")) {
      const message = "RawJobs is updating; try again in a few seconds.";
      if (url !== "/api/run") return json(res, { ok: false, type: "error", errors: message, message }, 503);
      res.setHeader("content-type", "application/x-ndjson");
      res.end(`${JSON.stringify({ type: "error", message })}
`);
      return;
    }
    if (url === "/api/check" && req.method === "POST") {
      // "Check now" on a directory job: fetch just that company, answer with the final event.
      const keys = ((JSON.parse((await readBody(req)) || "{}") as { keys?: unknown }).keys ?? []) as unknown[];
      const valid = keys.filter((k): k is string => typeof k === "string" && /^[a-z]+:[^\s]+$/i.test(k)).slice(0, 5);
      if (!valid.length) return json(res, { type: "error", message: "No company to check." }, 400);
      if (busy()) return json(res, { type: "error", message: "A scan is running; try again when it's done." });
      checking = true;
      try {
        const r = await collect(["run", "--progress", "ndjson", "--data", dataDir, ...valid.flatMap((k) => ["--check", k])], undefined, 180_000);
        const last = r.stdout.trim().split("\n").pop() ?? "";
        res.setHeader("content-type", "application/json");
        res.end(last.startsWith("{") ? last : JSON.stringify({ type: "error", message: (r.stderr || "check failed").trim().slice(-500) }));
      } finally {
        checking = false;
      }
      return;
    }
    if (url === "/api/scan/plan" && req.method === "GET") return await respondJson(res, ["scan", "--plan", "--data", dataDir]);
    if (url === "/api/alerts/telegram" && req.method === "GET") return await respondJson(res, ["alerts", "telegram", "status"]);
    const alert = url.match(/^\/api\/alerts\/telegram\/(token|connect|test|on|off|forget)$/);
    if (alert && req.method === "POST") return await respondJson(res, ["alerts", "telegram", alert[1]!], await readBody(req));
    if (url === "/api/schedule" && req.method === "GET") return await respondJson(res, ["schedule", "status", "--data", dataDir]);
    if (url === "/api/schedule" && req.method === "POST") return await respondJson(res, ["schedule", "install", "--stdin", "--data", dataDir], await readBody(req));
    if (url === "/api/schedule" && req.method === "DELETE") return await respondJson(res, ["schedule", "remove", "--data", dataDir]);
    if (url === "/api/schedule/run" && req.method === "POST") return await respondJson(res, ["schedule", "run", "--data", dataDir]);
    if (url === "/api/run/notify" && req.method === "POST") {
      // The running scan sends a Telegram message when it finishes (it checks for this file at the end).
      if (scan) writeFileSync(resolve(dataDir, "scan-notify"), "");
      return json(res, { ok: scan !== null });
    }
    if (url === "/api/run/stop" && req.method === "POST") {
      // The scan checks for this file between companies, saves its progress and stops.
      if (scan) writeFileSync(resolve(dataDir, "scan-stop"), "");
      return json(res, { ok: scan !== null });
    }
    if (url === "/api/run" && req.method === "GET") {
      if (!scan) {
        res.statusCode = 204;
        res.end();
      } else follow(res);
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
      if (busy()) {
        res.setHeader("content-type", "application/x-ndjson");
        res.end(`${JSON.stringify({ type: "error", message: "A scan is already running." })}\n`);
        return;
      }
      const body = (JSON.parse((await readBody(req)) || "{}") ?? {}) as { scope?: unknown; fresh?: unknown };
      startScan(body.scope === "all" || body.scope === "yours" ? body.scope : "mine", body.fresh === true);
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
    const update = cli(["directory", "update", "--auto", "--if-older", "7", "--data", dataDir]);
    update.on("error", () => {});
    update.on("close", () => void oneSuggestRun(() => collect(["companies", "suggest", "--json", "--data", dataDir])));
  }

  /**
   * Before the server exits (Ctrl+C, an update): ask a running scan to stop (it saves what it has,
   * and the next scan resumes), and end it if it hasn't after `graceMs`. Tabs following it are closed.
   */
  async function stop(graceMs = 10_000): Promise<void> {
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

  return { handle, startBackground, version, scanning: busy, stop };
}

function readBody(req: IncomingMessage, maxBytes = 5_000_000): Promise<string> {
  return new Promise((done, fail) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => {
      body += d;
      if (body.length > maxBytes) {
        fail(new Error("Request too large."));
        req.destroy();
      }
    });
    req.on("end", () => done(body));
    req.on("error", fail);
  });
}
