import { spawn } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
/** The run output folder is served as the site root: /jobs.json, /meta.json. */
const dataDir = resolve(repoRoot, process.env.RAWJOBS_DATA ?? process.env.JOBHUNTER_DATA ?? "data");
// Vite only serves a public dir that exists at startup; the first scan creates the files later.
mkdirSync(dataDir, { recursive: true });
const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const rawjobsCli = resolve(repoRoot, "packages/cli/src/index.ts");

/** Run `rawjobs <args>` from the repo root (node + tsx directly: no shell, so no quoting issues). */
function cli(args: string[], stdin?: string) {
  const child = spawn(process.execPath, [tsxCli, rawjobsCli, ...args], { cwd: repoRoot });
  if (stdin !== undefined) child.stdin.end(stdin);
  else child.stdin.end();
  return child;
}

function collect(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = cli(args, stdin);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => done({ code: 1, stdout, stderr: String(err) }));
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
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

/**
 * Dev only: a small local API so the dashboard can set up and run RawJobs on this machine.
 *   GET  /api/setup           setup status (+ current config)
 *   POST /api/setup/config    validate and save rawjobs.config.local.yaml
 *   POST /api/setup/reset     start setup over: move the config to rawjobs.config.local.backup.yaml
 *   POST /api/setup/check    detect + live-check careers URLs
 *   GET/POST/DELETE /api/setup/resume  read / save / remove the master resume (profile/resume.md, gitignored)
 *   GET  /api/directory       the shared company directory's local copy (and what's waiting to be shared)
 *   POST /api/directory/update download the latest shared directory and share waiting additions
 *   POST /api/companies/suggest  companies that fit a profile ({ profile?, watched?, hidden? }), with lookalikes of past employers
 *   POST /api/run             scan ({ scope: "mine" | "all", fresh? }); streams NDJSON progress
 *   POST /api/run/stop        stop the running scan after the companies in progress (it can be resumed)
 *   POST /api/run/notify      send a Telegram message when the running scan finishes
 *   GET  /api/scan/plan       what each scan type covers: companies, about how long, a stopped scan to resume
 *   GET  /api/alerts/telegram Telegram alerts: set up? on? (the token is never sent back, only masked)
 *   POST /api/alerts/telegram/{token|connect|test|on|off|forget}   set up and manage Telegram alerts
 *   GET/POST/DELETE /api/schedule   scheduled scans on this computer: status, install ({ times, scope }), remove
 *   POST /api/check           check directory companies now ({ keys: ["ats:slug"] }); answers with the done event
 * Not part of the static build; the dev server listens on 127.0.0.1 only.
 */
function localApi(): Plugin {
  let running = false;
  return {
    name: "rawjobs-local-api",
    apply: "serve",
    configureServer(server) {
      // Keep the shared company directory fresh: a weekly check in the background, off if you turned it off.
      cli(["directory", "update", "--auto", "--if-older", "7", "--data", dataDir]).on("error", () => {});
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/api/")) return next();
        try {
          if (url === "/api/setup" && req.method === "GET") return await respondJson(res, ["setup", "status", "--data", dataDir]);
          if (url === "/api/setup/config" && req.method === "POST") return await respondJson(res, ["setup", "save"], await readBody(req));
          if (url === "/api/setup/reset" && req.method === "POST") {
            if (running) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ ok: false, errors: "A scan is running; try again when it's done." }));
              return;
            }
            return await respondJson(res, ["setup", "reset"]);
          }
          if (url === "/api/setup/resume" && req.method === "GET") return await respondJson(res, ["setup", "resume"]);
          if (url === "/api/setup/resume" && req.method === "POST") return await respondJson(res, ["setup", "resume", "save"], await readBody(req));
          if (url === "/api/setup/resume" && req.method === "DELETE") return await respondJson(res, ["setup", "resume", "delete"]);
          if (url === "/api/setup/check" && req.method === "POST") return await respondJson(res, ["setup", "check", "--data", dataDir], await readBody(req));
          if (url === "/api/directory" && req.method === "GET") return await respondJson(res, ["directory", "status", "--json", "--data", dataDir]);
          if (url === "/api/directory/update" && req.method === "POST") return await respondJson(res, ["directory", "update", "--json", "--data", dataDir]);
          if (url === "/api/companies/suggest" && req.method === "POST") {
            res.setHeader("content-type", "application/json");
            try {
              res.end(await suggestions(await readBody(req)));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, errors: (err as Error).message }));
            }
            return;
          }
          if (url === "/api/check" && req.method === "POST") {
            // "Check now" on a directory job: fetch just that company, answer with the final event.
            res.setHeader("content-type", "application/json");
            const keys = ((JSON.parse((await readBody(req)) || "{}") as { keys?: unknown }).keys ?? []) as unknown[];
            const valid = keys.filter((k): k is string => typeof k === "string" && /^[a-z]+:[^\s]+$/i.test(k)).slice(0, 5);
            if (!valid.length) {
              res.statusCode = 400;
              res.end(JSON.stringify({ type: "error", message: "No company to check." }));
              return;
            }
            if (running) {
              res.end(JSON.stringify({ type: "error", message: "A scan is running; try again when it's done." }));
              return;
            }
            running = true;
            try {
              const r = await collect(["run", "--progress", "ndjson", "--data", dataDir, ...valid.flatMap((k) => ["--check", k])]);
              const last = r.stdout.trim().split("\n").pop() ?? "";
              res.end(last.startsWith("{") ? last : JSON.stringify({ type: "error", message: (r.stderr || "check failed").trim().slice(-500) }));
            } finally {
              running = false;
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
            if (running) writeFileSync(resolve(dataDir, "scan-notify"), "");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: running }));
            return;
          }
          if (url === "/api/run/stop" && req.method === "POST") {
            // The scan checks for this file between companies, saves its progress and stops.
            if (running) writeFileSync(resolve(dataDir, "scan-stop"), "");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: running }));
            return;
          }
          if (url === "/api/run" && req.method === "POST") {
            res.setHeader("content-type", "application/x-ndjson");
            res.setHeader("cache-control", "no-cache");
            if (running) {
              res.end(`${JSON.stringify({ type: "error", message: "A scan is already running." })}\n`);
              return;
            }
            const body = (JSON.parse((await readBody(req)) || "{}") ?? {}) as { scope?: unknown; fresh?: unknown };
            const scope = body.scope === "all" ? "all" : "mine";
            running = true;
            const child = cli(["scan", "--progress", "ndjson", "--scope", scope, ...(body.fresh === true ? ["--fresh"] : []), "--data", dataDir]);
            let stderr = "";
            child.stdout.pipe(res, { end: false });
            child.stderr.on("data", (d) => (stderr += d));
            child.on("close", (code) => {
              running = false;
              if (code !== 0 && stderr) res.write(`${JSON.stringify({ type: "error", message: stderr.trim().slice(-1500) })}\n`);
              res.end();
            });
            return;
          }
          res.statusCode = 404;
          res.end();
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, errors: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: dataDir,
  plugins: [react(), tailwindcss(), localApi()],
  // open: `pnpm dev` opens the dashboard in your browser (BROWSER=none turns that off).
  server: { port: 5173, host: "127.0.0.1", open: true },
});
