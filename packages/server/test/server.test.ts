import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRoutes, Health, TrackingRead } from "@rawjobs/core/protocol";
import { folderId } from "@rawjobs/core/update";
import { cmdAlerts } from "../../cli/src/commands/alerts";
import { cmdSetup } from "../../cli/src/commands/setup";
import { createApi } from "../src/api";
import { refuse, refuseHost } from "../src/guard";
import { createHandler } from "../src/handler";
import { findFile } from "../src/static";

/** Wait until `ok()` is true (checked every 10 ms, for up to 5 s). */
async function until(ok: () => boolean) {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!ok()) throw new Error("timed out waiting");
}

const req = (method: string, headers: Record<string, string>) => ({ method, headers }) as unknown as IncomingMessage;

describe("refuse", () => {
  it("lets this computer's own page read and write", () => {
    expect(refuse(req("GET", { host: "127.0.0.1:4317" }))).toBeNull();
    expect(refuse(req("POST", { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" }))).toBeNull();
    expect(refuse(req("DELETE", { host: "localhost:5173", origin: "http://localhost:5173" }))).toBeNull();
    expect(refuse(req("POST", { host: "[::1]:4317", origin: "http://[::1]:4317" }))).toBeNull();
  });

  it("turns away other sites, rebound domains and requests without an Origin", () => {
    expect(refuse(req("POST", { host: "127.0.0.1:4317", origin: "https://evil.example" }))).toMatch(/other sites/);
    expect(refuse(req("POST", { host: "127.0.0.1:4317", origin: "http://127.0.0.1:9999" }))).toMatch(/other sites/);
    expect(refuse(req("POST", { host: "127.0.0.1:4317", origin: "null" }))).not.toBeNull();
    expect(refuse(req("POST", { host: "127.0.0.1:4317" }))).toMatch(/Origin/);
    expect(refuse(req("GET", { host: "evil.example:4317" }))).toMatch(/only answers/);
    expect(refuse(req("POST", { host: "evil.example:4317", origin: "http://evil.example:4317" }))).toMatch(/only answers/);
  });

  it("checks the Host alone for any method (refuseHost)", () => {
    for (const host of ["127.0.0.1:4317", "localhost:4317", "[::1]:4317", "LOCALHOST:4317"]) expect(refuseHost(req("GET", { host }))).toBeNull();
    for (const host of ["evil.example:4317", "127.0.0.1.evil.example:4317", "rawjobs.local:4317", ""]) expect(refuseHost(req("GET", { host }))).toMatch(/only answers/);
  });
});

describe("every request (handler)", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function start() {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-handler-"));
    const web = join(dir, "web");
    const dataDir = join(dir, "data");
    const home = join(dir, "home");
    for (const d of [web, dataDir, home]) mkdirSync(d);
    writeFileSync(join(web, "index.html"), "<!doctype html><title>RawJobs</title>");
    writeFileSync(join(dataDir, "meta.json"), JSON.stringify({ profile: { name: "Test Person" } }));
    const api = createApi({ home, dataDir, version: "9.9.9" });
    server = createServer(createHandler({ api, roots: [web, dataDir], pages: { startLink: () => false, platform: "linux" } }));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return (server!.address() as AddressInfo).port;
  }

  /** GET `path` with exactly these headers (Host included: `undefined` sends none). */
  function get(port: number, path: string, host: string | undefined, extra: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; text: string }>((done, fail) => {
      const r = request({ host: "127.0.0.1", port, path, setHost: false, headers: { ...(host ? { host } : {}), ...extra } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => done({ status: res.statusCode!, headers: res.headers, text }));
      });
      r.on("error", fail);
      r.end();
    });
  }

  it("turns a foreign Host away from every path, data files included (DNS rebinding)", async () => {
    const port = await start();
    for (const path of ["/meta.json", "/", "/index.html", "/offline.html", "/sw.js", "/radar", "/api/health", "/nothing-here"]) {
      const res = await get(port, path, `evil.example:${port}`);
      expect(res.status, path).toBe(403);
      expect(res.text, path).toMatch(/only answers on this computer/);
      expect(res.text, path).not.toContain("Test Person");
      expect(res.headers["cross-origin-resource-policy"], path).toBe("same-origin");
    }
  });

  it("refuses a request with no Host", async () => {
    const port = await start();
    // Node answers 400 itself (HTTP/1.1 requires Host); refuseHost covers it anyway (empty Host).
    const res = await get(port, "/meta.json", undefined);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text).not.toContain("Test Person");
  });

  it("serves this computer's own names, with CORP on every response", async () => {
    const port = await start();
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      for (const path of ["/meta.json", "/", "/offline.html", "/sw.js", "/api/health"]) {
        const res = await get(port, path, host);
        expect(res.status, `${host}${path}`).toBe(200);
        expect(res.headers["cross-origin-resource-policy"], `${host}${path}`).toBe("same-origin");
      }
      expect((await get(port, "/no-such-file.json", host)).headers["cross-origin-resource-policy"]).toBe("same-origin");
    }
    expect((await get(port, "/meta.json", `127.0.0.1:${port}`)).text).toContain("Test Person");
  });

  it("sends the Content-Security-Policy on pages, not on data", async () => {
    const port = await start();
    const host = `127.0.0.1:${port}`;
    for (const path of ["/", "/offline.html", "/nothing-here"]) {
      expect((await get(port, path, host, { accept: "text/html" })).headers["content-security-policy"], path).toMatch(/script-src 'self'/);
    }
    expect((await get(port, "/meta.json", host)).headers["content-security-policy"]).toBeUndefined();
  });

  it("logs a CSP report once, without an Origin, and only on this computer's Host", async () => {
    const port = await start();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({ "csp-report": { "document-uri": `http://127.0.0.1:${port}/`, "blocked-uri": "inline", "effective-directive": "script-src-elem" } });
    const post = (host: string) =>
      new Promise<number>((done, fail) => {
        const r = request({ host: "127.0.0.1", port, path: "/api/csp-report", method: "POST", setHost: false, headers: { host, "content-type": "application/csp-report" } }, (res) => {
          res.resume();
          res.on("end", () => done(res.statusCode!));
        });
        r.on("error", fail);
        r.end(body);
      });
    expect(await post(`127.0.0.1:${port}`)).toBe(204);
    expect(await post(`127.0.0.1:${port}`)).toBe(204);
    expect(await post(`evil.example:${port}`)).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/CSP blocked inline by script-src-elem/);
    warn.mockRestore();
  });

  it("still lets a dashboard on another port of this computer read /api/health", async () => {
    const port = await start();
    const res = await get(port, "/api/health", `127.0.0.1:${port}`, { origin: "http://127.0.0.1:4318" });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4318");
  });
});

describe("findFile", () => {
  const root = mkdtempSync(join(tmpdir(), "rawjobs-static-"));
  const data = mkdtempSync(join(tmpdir(), "rawjobs-data-"));
  writeFileSync(join(root, "index.html"), "<!doctype html>");
  writeFileSync(join(data, "jobs.json"), "[]");
  writeFileSync(join(tmpdir(), "rawjobs-secret.txt"), "no");

  it("serves the page, then the data folder", () => {
    expect(findFile([root, data], "/")).toBe(join(root, "index.html"));
    expect(findFile([root, data], "/jobs.json?t=1")).toBe(join(data, "jobs.json"));
    expect(findFile([root, data], "/missing.js")).toBeNull();
  });

  it("never leaves the roots", () => {
    expect(findFile([root], "/../rawjobs-secret.txt")).toBeNull();
    expect(findFile([root], "/%2e%2e/rawjobs-secret.txt")).toBeNull();
    expect(findFile([root], "/..%5crawjobs-secret.txt")).toBeNull();
    expect(findFile([root], "/%E0%A4%A")).toBeNull();
  });
});

describe("the API", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  /**
   * An API whose CLI is a stand-in: a scan prints a few NDJSON events, slowly; any other command
   * prints what it was given (folder, arguments, stdin) so a test can see how a route called it.
   */
  async function start(opts: { updating?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-api-"));
    mkdirSync(join(dir, "data"));
    const fake = join(dir, "fake-cli.mjs");
    writeFileSync(
      fake,
      `const args = process.argv.slice(2);
if (args[0] !== "scan" || args.includes("--plan")) {
  let stdin = "";
  for await (const chunk of process.stdin) stdin += chunk;
  console.log(JSON.stringify({ cwd: process.cwd(), args, stdin }));
  process.exit(0);
}
const wait = (ms) => new Promise((r) => setTimeout(r, process.env.FAKE_SCAN_SLOW ? ms * 20 : ms));
console.log(JSON.stringify({ type: "start", companies: ["A", "B"], total: 2 }));
await wait(150);
console.log(JSON.stringify({ type: "progress", done: 1 }));
await wait(150);
console.log(JSON.stringify({ type: "done", scope: args[args.indexOf("--scope") + 1] }));`,
    );
    const home = join(dir, "home");
    mkdirSync(home);
    const dataDir = join(dir, "data");
    const updater = opts.updating ? ({ updating: () => true } as unknown as Parameters<typeof createApi>[0]["updater"]) : undefined;
    const api = createApi({ home, dataDir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9", updater });
    server = createServer((rq, rs) => void api.handle(rq, rs));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server!.address() as AddressInfo).port;
    return { api, port, home, dataDir };
  }

  function call(port: number, method: string, path: string, body?: string, onFirstChunk?: (abort: () => void) => void, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; text: string }>((done, fail) => {
      const r = request({ host: "127.0.0.1", port, method, path, headers: { origin: `http://127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        let first = true;
        res.setEncoding("utf8");
        res.on("data", (d) => {
          text += d;
          if (first && onFirstChunk) {
            first = false;
            onFirstChunk(() => {
              r.destroy();
              done({ status: res.statusCode!, headers: res.headers, text });
            });
          }
        });
        res.on("end", () => done({ status: res.statusCode!, headers: res.headers, text }));
      });
      r.on("error", (e) => (r.destroyed ? undefined : fail(e)));
      r.end(body);
    });
  }

  it("saves a diagnostics file through rawjobs doctor --zip", async () => {
    const { port, dataDir } = await start();
    const r = await call(port, "POST", "/api/doctor");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).args).toEqual(["doctor", "--json", "--zip", "--data", dataDir]);
  });

  it("answers health and tracking with exactly the fields ApiRoutes gives the dashboard", async () => {
    // Every field of the protocol's types, checked by the compiler: a field added to one side only fails here.
    const healthKeys = Object.keys({
      ok: 1,
      version: 1,
      scanning: 1,
      background: 1,
      scanOrigin: 1,
      dataVersion: 1,
      trackingRev: 1,
      update: 1,
      startLink: 1,
      safeMode: 1,
      platform: 1,
      home: 1,
      pid: 1,
    } satisfies Record<keyof Health, 1>);
    const trackingKeys = Object.keys({ tracking: 1, rev: 1, epoch: 1 } satisfies Record<keyof TrackingRead, 1>);
    const { port } = await start();
    const health = JSON.parse((await call(port, "GET", "/api/health")).text) as ApiRoutes["GET /api/health"];
    expect(Object.keys(health).sort()).toEqual(healthKeys.sort());
    const tracking = JSON.parse((await call(port, "GET", "/api/tracking")).text) as ApiRoutes["GET /api/tracking"];
    expect(Object.keys(tracking).sort()).toEqual(trackingKeys.sort());
    expect(typeof tracking.rev).toBe("number");
    expect(typeof tracking.epoch).toBe("string");
  });

  it("answers health with the version", async () => {
    const { port, home } = await start();
    const r = await call(port, "GET", "/api/health");
    expect(JSON.parse(r.text)).toEqual({
      ok: true,
      version: "9.9.9",
      scanning: false,
      background: false,
      scanOrigin: null,
      dataVersion: null,
      trackingRev: 0,
      update: null,
      startLink: false,
      safeMode: false,
      platform: process.platform,
      home: folderId(home),
      pid: process.pid,
    });
  });

  it("lets a page on another port of this computer read health, and no other site", async () => {
    const { port } = await start();
    const from = (origin: string) =>
      new Promise<IncomingMessage["headers"]>((done, fail) => {
        request({ host: "127.0.0.1", port, path: "/api/health", headers: { origin } }, (res) => {
          res.resume();
          done(res.headers);
        })
          .on("error", fail)
          .end();
      });
    expect((await from("http://127.0.0.1:4317"))["access-control-allow-origin"]).toBe("http://127.0.0.1:4317");
    expect((await from("http://localhost:4320"))["access-control-allow-origin"]).toBe("http://localhost:4320");
    expect((await from("https://evil.example"))["access-control-allow-origin"]).toBeUndefined();
    expect((await from("http://127.0.0.1.evil.example:80"))["access-control-allow-origin"]).toBeUndefined();
  });

  it("says when a scheduled scan is running and when a scan wrote new results", async () => {
    const { port, dataDir } = await start();
    const health = async () => JSON.parse((await call(port, "GET", "/api/health")).text) as { background: boolean; dataVersion: string | null };
    // Another process (a scheduled scan) holds the scan lock.
    writeFileSync(join(dataDir, "scan.lock"), String(process.ppid));
    expect(await health()).toMatchObject({ background: true, dataVersion: null });
    rmSync(join(dataDir, "scan.lock"));
    writeFileSync(join(dataDir, "meta.json"), JSON.stringify({ version: 1, generatedAt: "2026-10-13T06:00:00.000Z" }));
    expect(await health()).toMatchObject({ background: false, dataVersion: "2026-10-13T06:00:00.000Z" });
    writeFileSync(join(dataDir, "meta.json"), JSON.stringify({ version: 1, generatedAt: "2026-10-13T18:00:00.000Z", runs: [] }));
    expect((await health()).dataVersion).toBe("2026-10-13T18:00:00.000Z");
    // Read from the file's start; a generatedAt past the first 4 KB still counts (the whole file is read).
    writeFileSync(join(dataDir, "meta.json"), JSON.stringify({ pad: "x".repeat(5000), generatedAt: "2026-10-14T06:00:00.000Z" }));
    expect((await health()).dataVersion).toBe("2026-10-14T06:00:00.000Z");
  });

  // Every way a scan starts gets the same: who started it, its progress, Stop, "tell me when done", and no second scan.
  it.each(["page", "scheduled", "terminal"] as const)("treats a scan started from the %s like any other", async (origin) => {
    const { port, dataDir } = await start();
    let page: Promise<unknown> | undefined;
    if (origin === "page") {
      process.env.FAKE_SCAN_SLOW = "1";
      page = call(port, "POST", "/api/run", "{}", (abort) => abort());
      await page;
    } else {
      writeFileSync(join(dataDir, "scan.lock"), String(process.ppid));
      const head = { origin, scope: "mine", pid: process.ppid, startedAt: "2026-11-22T06:00:00.000Z" };
      writeFileSync(join(dataDir, "scan-live.ndjson"), `${JSON.stringify(head)}\n${JSON.stringify({ type: "start", companies: [], total: 2, stage: "quick" })}\n`);
    }
    try {
      expect(JSON.parse((await call(port, "GET", "/api/health")).text).scanOrigin).toBe(origin);
      const followed = await call(port, "GET", "/api/run", undefined, (abort) => abort());
      expect(followed.status).toBe(200);
      expect(JSON.parse(followed.text.split("\n")[0]!)).toMatchObject({ type: "start" });
      expect(JSON.parse((await call(port, "POST", "/api/run/notify")).text)).toEqual({ ok: true });
      expect((await call(port, "POST", "/api/run", '{"scope":"yours"}')).text).toMatch(/is running|already running/);
      expect(JSON.parse((await call(port, "POST", "/api/run/stop")).text)).toEqual({ ok: true });
      expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    } finally {
      delete process.env.FAKE_SCAN_SLOW;
      rmSync(join(dataDir, "scan.lock"), { force: true });
    }
  });

  it("pauses a scheduled scan for an update only once it's in its background check", async () => {
    const { api, dataDir } = await start();
    writeFileSync(join(dataDir, "scan.lock"), String(process.ppid));
    const head = { origin: "scheduled", scope: "mine", pid: process.ppid, startedAt: "2026-11-22T06:00:00.000Z" };
    writeFileSync(join(dataDir, "scan-live.ndjson"), `${JSON.stringify(head)}\n${JSON.stringify({ type: "start", companies: [], total: 2, stage: "quick" })}\n`);
    expect(api.pauseBackground()).toBe(false);
    expect(existsSync(join(dataDir, "scan-stop"))).toBe(false);
    appendFileSync(join(dataDir, "scan-live.ndjson"), `${JSON.stringify({ type: "background" })}\n`);
    expect(api.pauseBackground()).toBe(true);
    expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    rmSync(join(dataDir, "scan.lock"));
  });

  it("shows, stops and makes way for a scan it didn't start (a scheduled one) through its live file", async () => {
    const { port, dataDir } = await start();
    const other = process.ppid;
    writeFileSync(join(dataDir, "scan.lock"), String(other));
    writeFileSync(
      join(dataDir, "scan-live.ndjson"),
      `${[
        { origin: "scheduled", scope: "mine", pid: other, startedAt: "2026-11-22T06:00:00.000Z" },
        { type: "start", companies: ["A"], total: 2, stage: "quick" },
        { type: "progress", done: 1 },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n")}\n`,
    );
    expect(JSON.parse((await call(port, "GET", "/api/health")).text)).toMatchObject({ scanning: false, background: true, scanOrigin: "scheduled" });

    // A tab follows it from the start, then each new line, until it lets go of the lock.
    // Each tick reads the file before it checks the lock, so the last line still goes out after the
    // lock is gone: once the tab has its first lines, nothing needs a wait.
    let following!: () => void;
    const attached = new Promise<void>((r) => (following = r));
    const follow = call(port, "GET", "/api/run", undefined, () => following());
    await attached;
    appendFileSync(join(dataDir, "scan-live.ndjson"), `${JSON.stringify({ type: "done", stage: "quick" })}\n`);
    rmSync(join(dataDir, "scan.lock"));
    const followed = await follow;
    expect(followed.headers["x-rawjobs-scope"]).toBe("mine");
    expect(followed.headers["x-rawjobs-origin"]).toBe("scheduled");
    expect(
      followed.text
        .trim()
        .split("\n")
        .map((l) => (JSON.parse(l) as { type: string }).type),
    ).toEqual(["start", "progress", "done"]);

    // Running again: Stop and "tell me when done" reach it through the files it checks.
    writeFileSync(join(dataDir, "scan.lock"), String(other));
    expect(JSON.parse((await call(port, "POST", "/api/run/stop")).text)).toEqual({ ok: true });
    expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    expect(JSON.parse((await call(port, "POST", "/api/run/notify")).text)).toEqual({ ok: true });
    rmSync(join(dataDir, "scan-stop"));

    // No second scan, no "Run now" and no Check now while it runs: each says why.
    expect((await call(port, "POST", "/api/run", "{}")).text).toMatch(/scheduled scan is running/);
    expect(JSON.parse((await call(port, "POST", "/api/schedule/run")).text)).toMatchObject({ ok: false });
    expect(JSON.parse((await call(port, "POST", "/api/check", '{"keys":["greenhouse:acme"]}')).text)).toMatchObject({ type: "error" });

    // In its background check it gives way to Scan now: asked to stop, then the new scan starts once it has.
    appendFileSync(join(dataDir, "scan-live.ndjson"), `${JSON.stringify({ type: "background" })}\n`);
    setTimeout(() => rmSync(join(dataDir, "scan.lock")), 700);
    const scanNow = await call(port, "POST", "/api/run", "{}");
    expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    expect(scanNow.text).toMatch(/"done"/);
  });

  it("runs the CLI in your RawJobs folder", async () => {
    const { port, home } = await start();
    expect(realpathSync(JSON.parse((await call(port, "DELETE", "/api/setup/resume")).text).cwd)).toBe(realpathSync(home));
  });

  it("saves your tracking in profile/tracking.json and reads it back", async () => {
    const { port, home } = await start();
    expect(JSON.parse((await call(port, "GET", "/api/tracking")).text)).toEqual({ tracking: null, rev: 0, epoch: "" });
    const put = await call(port, "PUT", "/api/tracking", JSON.stringify({ state: { j1: { status: "applied" } } }));
    expect(JSON.parse(put.text).ok).toBe(true);
    await call(port, "PUT", "/api/tracking", JSON.stringify({ prefs: { views: [] } }));
    const got = JSON.parse((await call(port, "GET", "/api/tracking")).text).tracking;
    expect(got.state).toEqual({ j1: { status: "applied" } });
    expect(got.prefs).toEqual({ views: [] });
    expect(existsSync(join(home, "profile/tracking.json"))).toBe(true);
    expect((await call(port, "PUT", "/api/tracking", "{ nope")).status).toBe(400);
    expect((await call(port, "PUT", "/api/tracking", JSON.stringify({ state: [] }))).status).toBe(400);
  });

  it("saves key-level changes with If-Match and answers a conflict with 409 and the current tracking", async () => {
    const { port } = await start();
    const patch = (ifMatch: string | null, changes: unknown) => call(port, "PATCH", "/api/tracking", JSON.stringify({ changes }), undefined, ifMatch ? { "if-match": ifMatch } : {});
    expect((await patch(null, { state: { set: { a: 1 } } })).status).toBe(400);
    const first = await patch('":0"', { state: { set: { a: 1, b: 1 } } });
    expect(first.status).toBe(200);
    const { rev, epoch } = JSON.parse(first.text) as { rev: number; epoch: string };
    expect(rev).toBe(1);
    // ETag equals rev (with the epoch); health says the same rev.
    const got = await call(port, "GET", "/api/tracking");
    expect(got.headers.etag).toBe(`"${epoch}:1"`);
    expect(JSON.parse(got.text)).toMatchObject({ rev: 1, epoch, tracking: { state: { a: 1, b: 1 } } });
    expect(JSON.parse((await call(port, "GET", "/api/health")).text).trackingRev).toBe(1);
    // Another window changes a; this one (still on rev 1) changes b and a.
    expect((await patch(`"${epoch}:1"`, { state: { set: { a: 2 } } })).status).toBe(200);
    expect((await patch(`"${epoch}:1"`, { state: { set: { b: 2 } } })).status).toBe(200);
    const clash = await patch(`"${epoch}:1"`, { state: { set: { a: 3 } } });
    expect(clash.status).toBe(409);
    expect(JSON.parse(clash.text)).toMatchObject({ ok: false, rev: 3, epoch, tracking: { state: { a: 2, b: 2 } }, conflicts: [{ part: "state", key: "a" }] });
    expect(JSON.parse((await call(port, "GET", "/api/health")).text).trackingRev).toBe(3);
    // An old cached page's PUT moves the rev too.
    const put = JSON.parse((await call(port, "PUT", "/api/tracking", JSON.stringify({ prefs: { v: 1 } }))).text);
    expect(put).toMatchObject({ ok: true, rev: 4, epoch });
  });

  it("answers 503 and changes nothing when tracking.json can't be read", async () => {
    const { port, home } = await start();
    // A folder where the file should be: there, but unreadable.
    mkdirSync(join(home, "profile/tracking.json"), { recursive: true });
    expect((await call(port, "GET", "/api/tracking")).status).toBe(503);
    expect((await call(port, "PUT", "/api/tracking", JSON.stringify({ state: {} }))).status).toBe(503);
    expect((await call(port, "PATCH", "/api/tracking", JSON.stringify({ changes: {} }), undefined, { "if-match": '":0"' })).status).toBe(503);
    expect(existsSync(join(home, "profile/tracking.json"))).toBe(true);
  });

  it("queues a confirmed careers-link move to share later, and checks it first", async () => {
    const { port, home, dataDir } = await start();
    const from = { ats: "lever", slug: "acme" };
    const to = { ats: "ashby", slug: "acme-inc" };
    const post = async (body: string) => {
      const r = await call(port, "POST", "/api/directory/moves", body);
      return { status: r.status, body: JSON.parse(r.text) };
    };
    const outbox = () => JSON.parse(readFileSync(join(dataDir, "catalog/moves-outbox.json"), "utf8")).moves;

    expect(await post(JSON.stringify({ name: "Acme", from, to }))).toEqual({ status: 200, body: { queued: true } });
    expect(await post(JSON.stringify({ name: "Acme", from, to }))).toEqual({ status: 200, body: { queued: true } });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ name: "Acme", from, to });

    // Not a move: bad JSON, no name, a board we couldn't scan, a URL for a slug, the same board twice.
    for (const bad of [
      "{ nope",
      JSON.stringify({ from, to }),
      JSON.stringify({ name: "Acme", from: { ats: "kenexa", slug: "acme" }, to }),
      JSON.stringify({ name: "Acme", from, to: { ats: "lever", slug: "https://evil.example/x" } }),
      JSON.stringify({ name: "Acme", from, to: { ats: "workday", slug: "acme" } }),
      JSON.stringify({ name: "Acme", from, to: { ats: "lever", slug: "ACME" } }),
      JSON.stringify({ name: "Acme", from, to: from }),
    ]) {
      const r = await post(bad);
      expect(r.status, bad).toBe(400);
      expect(r.body.ok, bad).toBe(false);
    }
    expect(outbox()).toHaveLength(1);

    // Sharing off in your settings: nothing is queued.
    writeFileSync(
      join(home, "rawjobs.config.local.yaml"),
      'profile:\n  titles: { include: ["engineer"] }\n  locations: { include: ["dubai"] }\ncompanies:\n  - { name: "Acme", ats: lever, slug: "acme" }\ndirectory:\n  share_additions: false\n',
    );
    expect(await post(JSON.stringify({ name: "Beta", from: { ats: "lever", slug: "beta" }, to }))).toEqual({
      status: 200,
      body: { queued: false, reason: "Sharing is off in your settings." },
    });
    expect(outbox()).toHaveLength(1);
  });

  it("refuses a POST from another site", async () => {
    const { port } = await start();
    const r = await new Promise<number>((done) => {
      request({ host: "127.0.0.1", port, method: "POST", path: "/api/setup/reset", headers: { origin: "https://evil.example" } }, (res) => {
        res.resume();
        done(res.statusCode!);
      }).end();
    });
    expect(r).toBe(403);
  });

  it("keeps scanning when the tab goes away, and a new tab picks it up from the start", async () => {
    const { api, port } = await start();
    // The tab that started the scan leaves after the first event.
    await call(port, "POST", "/api/run", JSON.stringify({ scope: "all" }), (abort) => abort());
    expect(api.scanning()).toBe(true);
    const again = await call(port, "GET", "/api/run");
    expect(again.status).toBe(200);
    expect(again.headers["x-rawjobs-scope"]).toBe("all");
    const types = again.text
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toEqual(["start", "progress", "done"]);
    expect(api.scanning()).toBe(false);
    expect((await call(port, "GET", "/api/run")).status).toBe(204);
  });

  it("runs one scan at a time", async () => {
    const { api, port } = await start();
    const first = call(port, "POST", "/api/run", "{}");
    // Once the first is really running (no fixed wait: CI machines are slow at times).
    await until(() => api.scanning());
    const second = await call(port, "POST", "/api/run", "{}");
    expect(second.text).toMatch(/already running/);
    expect((await first).text).toMatch(/"done"/);
  });

  it("hands each route to the right CLI command, with the request body on stdin", async () => {
    const { port, dataDir } = await start();
    const routes: [method: string, path: string, args: string[], body?: string][] = [
      ["POST", "/api/setup/config", ["setup", "save"], '{"profile":{}}'],
      ["POST", "/api/setup/reset", ["setup", "reset"]],
      ["POST", "/api/setup/resume", ["setup", "resume", "save"], "# Resume"],
      ["DELETE", "/api/setup/resume", ["setup", "resume", "delete"]],
      ["POST", "/api/setup/check", ["setup", "check", "--data", dataDir], '{"urls":["https://jobs.lever.co/acme"]}'],
      ["GET", "/api/directory", ["directory", "status", "--json", "--data", dataDir]],
      ["POST", "/api/directory/update", ["directory", "update", "--json", "--data", dataDir]],
      ["GET", "/api/scan/plan", ["scan", "--plan", "--data", dataDir]],
      ["POST", "/api/alerts/telegram/token", ["alerts", "telegram", "token"], '{"token":"x"}'],
      ["POST", "/api/alerts/telegram/forget", ["alerts", "telegram", "forget"]],
      ["GET", "/api/schedule", ["schedule", "status", "--data", dataDir]],
      ["POST", "/api/schedule", ["schedule", "install", "--stdin", "--data", dataDir], '{"times":["08:00"]}'],
      ["DELETE", "/api/schedule", ["schedule", "remove", "--data", dataDir]],
      ["POST", "/api/schedule/run", ["schedule", "run", "--data", dataDir]],
      ["GET", "/api/daily-summary", ["today", "status", "--data", dataDir]],
      ["POST", "/api/daily-summary", ["today", "install", "--stdin", "--data", dataDir], '{"time":"09:00"}'],
      ["DELETE", "/api/daily-summary", ["today", "remove", "--data", dataDir]],
      ["POST", "/api/daily-summary/test", ["today", "--test", "--json", "--data", dataDir]],
      ["POST", "/api/check", ["run", "--progress", "ndjson", "--data", dataDir, "--check", "lever:acme", "--check", "ashby:beta"], '{"keys":["lever:acme","ashby:beta","no spaces allowed",7]}'],
    ];
    for (const [method, path, args, body] of routes) {
      const r = await call(port, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(200);
      let got: { args: string[]; stdin: string };
      try {
        got = JSON.parse(r.text);
      } catch {
        throw new Error(`${method} ${path} answered: ${r.text.slice(0, 300)}`);
      }
      expect(got.args, `${method} ${path}`).toEqual(args);
      if (body && path !== "/api/check") expect(got.stdin, `${method} ${path}`).toBe(body);
    }
  });

  it("answers setup and Telegram in this process, as the CLI prints them", async () => {
    const { port, home, dataDir } = await start();
    writeFileSync(join(home, "rawjobs.config.local.yaml"), readFileSync(join(import.meta.dirname, "../../../rawjobs.config.example.yaml"), "utf8"));
    /** What the CLI command prints, run here with your RawJobs folder as its home. */
    const cli = async (run: () => Promise<number> | number) => {
      const before = process.env.RAWJOBS_HOME;
      process.env.RAWJOBS_HOME = home;
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await run();
        return JSON.parse(String(log.mock.calls.at(-1)![0])) as unknown;
      } finally {
        log.mockRestore();
        if (before === undefined) delete process.env.RAWJOBS_HOME;
        else process.env.RAWJOBS_HOME = before;
      }
    };
    const get = async (path: string) => {
      const r = await call(port, "GET", path);
      expect(r.status, path).toBe(200);
      return JSON.parse(r.text) as unknown;
    };
    expect(await get("/api/setup")).toEqual(await cli(() => cmdSetup(["status", "--data", dataDir])));
    expect(await get("/api/alerts/telegram")).toEqual(await cli(() => cmdAlerts(["telegram", "status"])));
    expect(await get("/api/setup/resume")).toEqual(await cli(() => cmdSetup(["resume"])));
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile/resume.md"), "# Resume\n");
    expect(await get("/api/setup/resume")).toEqual(await cli(() => cmdSetup(["resume"])));
    expect(await get("/api/setup/resume")).toMatchObject({ text: "# Resume\n" });
  });

  it("keeps read-only answers a while, and forgets them after a save", async () => {
    const { port, home } = await start();
    const config = join(home, "rawjobs.config.local.yaml");
    writeFileSync(config, readFileSync(join(import.meta.dirname, "../../../rawjobs.config.example.yaml"), "utf8"));
    const valid = async () => (JSON.parse((await call(port, "GET", "/api/setup")).text) as { valid: boolean }).valid;
    expect(await valid()).toBe(true);
    writeFileSync(config, "profile: [");
    expect(await valid()).toBe(true);
    await call(port, "POST", "/api/setup/config", "{}");
    expect(await valid()).toBe(false);

    // The schedule, scan plan and directory are read by the CLI: asked again, it isn't run again until a save.
    const first = await call(port, "GET", "/api/schedule");
    expect(JSON.parse(first.text)).toMatchObject({ args: ["schedule", "status", "--data", expect.any(String)] });
    const plan = (await call(port, "GET", "/api/scan/plan")).text;
    const directory = (await call(port, "GET", "/api/directory")).text;
    writeFileSync(join(home, "../fake-cli.mjs"), "process.exit(1);");
    expect((await call(port, "GET", "/api/schedule")).text).toBe(first.text);
    expect((await call(port, "GET", "/api/scan/plan")).text).toBe(plan);
    expect((await call(port, "GET", "/api/directory")).text).toBe(directory);
    expect((await call(port, "DELETE", "/api/schedule")).status).toBe(500);
    const after = await call(port, "GET", "/api/schedule");
    expect(after.status).toBe(500);
    expect(JSON.parse(after.text)).toMatchObject({ ok: false });
    expect((await call(port, "GET", "/api/scan/plan")).status).toBe(500);
  });

  it("keeps the daily summary's status until it's changed", async () => {
    const { port, home } = await start();
    const first = await call(port, "GET", "/api/daily-summary");
    expect(JSON.parse(first.text)).toMatchObject({ args: ["today", "status", "--data", expect.any(String)] });
    writeFileSync(join(home, "../fake-cli.mjs"), "process.exit(1);");
    expect((await call(port, "GET", "/api/daily-summary")).text).toBe(first.text);
    expect((await call(port, "DELETE", "/api/daily-summary")).status).toBe(500);
    expect((await call(port, "GET", "/api/daily-summary")).status).toBe(500);
  });

  it("runs at most 3 short CLI commands at once, the rest in turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-slots-"));
    const log = join(dir, "calls.log");
    const fake = join(dir, "slow-cli.mjs");
    writeFileSync(
      fake,
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, "+\\n");\nsetTimeout(() => { appendFileSync(${JSON.stringify(log)}, "-\\n"); console.log("{}"); }, 300);`,
    );
    const api = createApi({ home: dir, dataDir: dir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9" });
    const runs = await Promise.all(Array.from({ length: 7 }, () => api.cli(["x"])));
    expect(runs.every((r) => r.code === 0)).toBe(true);
    let now = 0;
    let most = 0;
    for (const step of readFileSync(log, "utf8").trim().split("\n")) {
      now += step === "+" ? 1 : -1;
      most = Math.max(most, now);
    }
    expect(most).toBe(3);
    expect(now).toBe(0);
  });

  it("says how many companies a suggestion request checks, without running the CLI, and again once the index changes", async () => {
    const { port, dataDir } = await start();
    const size = async () => JSON.parse((await call(port, "GET", "/api/companies/suggest/size")).text);
    expect(await size()).toEqual({ companies: null });
    mkdirSync(join(dataDir, "catalog"));
    const directory = { companies: [{ key: "lever:a", indexed: true }, { key: "lever:b" }] };
    writeFileSync(join(dataDir, "catalog", "directory.json"), JSON.stringify(directory));
    writeFileSync(join(dataDir, "catalog", "index.json"), JSON.stringify({ generated_at: "2026-10-07", count: 24686, companies: [] }));
    expect(await size()).toEqual({ companies: 24687 });
  });

  it("answers what it can't do: no company to check, an unknown route, stop or notify with no scan", async () => {
    const { port } = await start();
    expect((await call(port, "POST", "/api/check", '{"keys":["not a key"]}')).status).toBe(400);
    expect((await call(port, "GET", "/api/nothing-here")).status).toBe(404);
    expect(JSON.parse((await call(port, "POST", "/api/run/stop")).text)).toEqual({ ok: false });
    expect(JSON.parse((await call(port, "POST", "/api/run/notify")).text)).toEqual({ ok: false });
  });

  it("asks a running scan to stop, or to send its message, through files the scan checks", async () => {
    const { api, port, dataDir } = await start();
    // The slow fake scan (about 6 s): the quick one (0.3 s) could end before the requests below on
    // a busy Windows runner, and a scan that has ended answers { ok: false }.
    process.env.FAKE_SCAN_SLOW = "1";
    try {
      await call(port, "POST", "/api/run", "{}", (abort) => abort());
      await until(() => api.scanning());
      expect(JSON.parse((await call(port, "POST", "/api/run/notify")).text)).toEqual({ ok: true });
      expect(existsSync(join(dataDir, "scan-notify"))).toBe(true);
      expect(JSON.parse((await call(port, "POST", "/api/run/stop")).text)).toEqual({ ok: true });
      expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    } finally {
      delete process.env.FAKE_SCAN_SLOW;
    }
  });

  it("starts nothing new while RawJobs is updating", async () => {
    const { port } = await start({ updating: true });
    expect((await call(port, "POST", "/api/run", "{}")).text).toMatch(/updating/);
    expect((await call(port, "POST", "/api/check", '{"keys":["lever:acme"]}')).status).toBe(503);
    expect((await call(port, "POST", "/api/schedule/run")).status).toBe(503);
  });

  it("keeps suggestion answers on disk, so a restart answers without running the CLI until an input changes", async () => {
    const { port, home, dataDir } = await start();
    const config = join(home, "rawjobs.config.local.yaml");
    const example = readFileSync(join(import.meta.dirname, "../../../rawjobs.config.example.yaml"), "utf8");
    writeFileSync(config, example);
    const body = JSON.stringify({ watched: ["greenhouse:a"] });
    const first = await call(port, "POST", "/api/companies/suggest", body);
    expect(JSON.parse(first.text)).toMatchObject({ args: ["companies", "suggest", "--json", "--stdin", "--data", dataDir], stdin: body });
    server!.close();

    // Restarted with a CLI that only fails: the saved answer is served.
    const broken = join(home, "broken-cli.mjs");
    writeFileSync(broken, "process.exit(1);");
    const api = createApi({ home, dataDir, cli: { command: process.execPath, args: [broken] }, version: "9.9.9" });
    server = createServer((rq, rs) => void api.handle(rq, rs));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const again = (server!.address() as AddressInfo).port;
    expect((await call(again, "POST", "/api/companies/suggest", body)).text).toBe(first.text);

    // Saving a setting the answer doesn't read changes nothing...
    writeFileSync(config, `${example}\n# a note\n`);
    expect((await call(again, "POST", "/api/companies/suggest", body)).text).toBe(first.text);
    // ...but another body, or muting a company, needs the CLI again.
    expect((await call(again, "POST", "/api/companies/suggest", JSON.stringify({ watched: [] }))).status).toBe(500);
    writeFileSync(config, `${example}\ncompanies_muted: ["greenhouse:zzz"]\n`);
    expect((await call(again, "POST", "/api/companies/suggest", body)).status).toBe(500);
  });

  it("ranks companies in the background once the directory is up to date", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-warm-"));
    const log = join(dir, "calls.log");
    const fake = join(dir, "log-cli.mjs");
    writeFileSync(fake, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, process.argv.slice(2, 4).join(" ") + "\\n");\nconsole.log("{}");`);
    const api = createApi({ home: dir, dataDir: dir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9" });
    api.startBackground();
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
    await until(() => calls().length >= 2 && existsSync(join(dir, "cache/suggestions/warm.json")));
    expect(calls()).toEqual(["directory update", "companies suggest"]);

    // Started again with the same index, directory, resume and config: no second ranking.
    const again = createApi({ home: dir, dataDir: dir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9" });
    again.startBackground();
    await until(() => calls().length >= 3);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls()).toEqual(["directory update", "companies suggest", "directory update"]);

    // A new resume is a new ranking.
    mkdirSync(join(dir, "profile"));
    writeFileSync(join(dir, "profile/resume.md"), "# Resume\n");
    createApi({ home: dir, dataDir: dir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9" }).startBackground();
    await until(() => calls().length >= 5);
    expect(calls().slice(3)).toEqual(["directory update", "companies suggest"]);
  });

  it("on shutdown, asks the running scan to stop and waits for it", async () => {
    const { api, port, dataDir } = await start();
    const run = call(port, "POST", "/api/run", "{}");
    await until(() => api.scanning());
    await api.stop(5_000);
    expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    // The tab following it was closed rather than left hanging.
    expect((await run).text).toMatch(/"start"/);
  });
});
