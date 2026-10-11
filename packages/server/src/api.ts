import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { refuse } from "./guard";

export type ApiOptions = {
  /** Where rawjobs.config.local.yaml and profile/ live; the CLI runs here. */
  repoRoot: string;
  /** The run output folder (jobs.json, meta.json, catalog/…). */
  dataDir: string;
  /** How to start the CLI: a program and the arguments before the command. Default: node + tsx + the CLI source. */
  cli?: { command: string; args: string[] };
};

/** One line of the scan's NDJSON progress. */
type Line = string;

/**
 * The dashboard's API: everything it needs to set up and run RawJobs on this computer.
 *   GET  /api/health          { ok, version, scanning }: is the server up, and which version
 *   GET  /api/setup           setup status (+ current config)
 *   POST /api/setup/config    validate and save rawjobs.config.local.yaml
 *   POST /api/setup/reset     start setup over: move the config to rawjobs.config.local.backup.yaml
 *   POST /api/setup/check     detect + live-check careers URLs
 *   GET/POST/DELETE /api/setup/resume  read / save / remove the master resume (profile/resume.md, gitignored)
 *   GET  /api/directory       the shared company directory's local copy (and what's waiting to be shared)
 *   POST /api/directory/update download the latest shared directory and share waiting additions
 *   POST /api/companies/suggest  companies that fit a profile ({ profile?, watched?, hidden? }), with lookalikes of past employers
 *   POST /api/run             scan ({ scope: "mine" | "all", fresh? }); streams NDJSON progress
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
  const { repoRoot, dataDir } = opts;
  const cliCmd = opts.cli ?? {
    command: process.execPath,
    args: [resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"), resolve(repoRoot, "packages/cli/src/index.ts")],
  };
  const version = readVersion(repoRoot);

  /** Run `rawjobs <args>` from the repo root (no shell, so no quoting issues). */
  function cli(args: string[], stdin?: string): ChildProcess {
    const child = spawn(cliCmd.command, [...cliCmd.args, ...args], { cwd: repoRoot, windowsHide: true });
    if (stdin !== undefined) child.stdin!.end(stdin);
    else child.stdin!.end();
    return child;
  }

  function collect(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((done) => {
      const child = cli(args, stdin);
      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (d) => (stdout += d));
      child.stderr!.on("data", (d) => (stderr += d));
      child.on("error", (err) => done({ code: 1, stdout, stderr: String(err) }));
      child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
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
   * Company suggestions read the whole 40 MB index (about 10 s), so answers are kept per request
   * body until the index, directory or resume changes. Identical requests in flight share one run.
   */
  const suggestCache = new Map<string, Promise<string>>();
  function suggestions(body: string): Promise<string> {
    const mtime = (path: string) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return 0;
      }
    };
    const stamp = [resolve(dataDir, "catalog/index.json"), resolve(dataDir, "catalog/directory.json"), resolve(dataDir, "catalog/additions.json"), resolve(repoRoot, "profile/resume.md")].map(mtime).join(":");
    const key = `${stamp}|${body}`;
    let hit = suggestCache.get(key);
    if (!hit) {
      hit = collect(["companies", "suggest", "--json", "--stdin", "--data", dataDir], body).then((r) => {
        const out = r.stdout.trim();
        if (!out.startsWith("{")) throw new Error((r.stderr || "suggestions failed").trim().slice(-1500));
        return out;
      });
      hit.catch(() => suggestCache.delete(key));
      suggestCache.set(key, hit);
      // Keep the last few profiles only.
      for (const k of [...suggestCache.keys()].slice(0, -6)) suggestCache.delete(k);
    }
    return hit;
  }

  // ---------- the running scan ----------
  /** The scan the server is running: its scope, every progress line so far, and the tabs following it. */
  let scan: { scope: string; lines: Line[]; partial: string; followers: Set<ServerResponse> } | null = null;
  /** "Check now" runs: they share the one-at-a-time rule with scans. */
  let checking = false;
  const busy = () => scan !== null || checking;

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
    scan.lines.push(line);
    for (const res of scan.followers) if (!res.writableEnded) res.write(`${line}\n`);
  }

  function startScan(scope: "mine" | "all", fresh: boolean) {
    const child = cli(["scan", "--progress", "ndjson", "--scope", scope, ...(fresh ? ["--fresh"] : []), "--data", dataDir]);
    scan = { scope, lines: [], partial: "", followers: new Set() };
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
        if (!res.headersSent) json(res, { ok: false, errors: String(err) }, 500);
        else res.end();
      }
    }
    return true;
  }

  async function route(url: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (url === "/api/health" && req.method === "GET") return json(res, { ok: true, version, scanning: busy() });
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
    if (url === "/api/companies/suggest" && req.method === "POST") {
      try {
        res.setHeader("content-type", "application/json");
        res.end(await suggestions(await readBody(req)));
      } catch (err) {
        json(res, { ok: false, errors: (err as Error).message }, 500);
      }
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
        const r = await collect(["run", "--progress", "ndjson", "--data", dataDir, ...valid.flatMap((k) => ["--check", k])]);
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
      if (busy()) {
        res.setHeader("content-type", "application/x-ndjson");
        res.end(`${JSON.stringify({ type: "error", message: "A scan is already running." })}\n`);
        return;
      }
      const body = (JSON.parse((await readBody(req)) || "{}") ?? {}) as { scope?: unknown; fresh?: unknown };
      startScan(body.scope === "all" ? "all" : "mine", body.fresh === true);
      follow(res);
      return;
    }
    res.statusCode = 404;
    res.end();
  }

  /** Keep the shared company directory fresh: a weekly check in the background, off if you turned it off. */
  function startBackground() {
    cli(["directory", "update", "--auto", "--if-older", "7", "--data", dataDir]).on("error", () => {});
  }

  return { handle, startBackground, version, scanning: busy };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (d) => (body += d));
    req.on("end", () => done(body));
    req.on("error", fail);
  });
}

function readVersion(repoRoot: string): string {
  try {
    return (JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
