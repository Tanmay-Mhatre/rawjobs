import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api";
import { refuse } from "../src/guard";
import { findFile } from "../src/static";

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

  /** An API whose CLI is a stand-in that prints a few NDJSON events, slowly. */
  async function start() {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-api-"));
    mkdirSync(join(dir, "data"));
    const fake = join(dir, "fake-cli.mjs");
    writeFileSync(
      fake,
      `const args = process.argv.slice(2);
if (args[0] !== "scan") { console.log(JSON.stringify({ cwd: process.cwd() })); process.exit(0); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(JSON.stringify({ type: "start", companies: ["A", "B"], total: 2 }));
await wait(150);
console.log(JSON.stringify({ type: "progress", done: 1 }));
await wait(150);
console.log(JSON.stringify({ type: "done", scope: args[args.indexOf("--scope") + 1] }));`,
    );
    const home = join(dir, "home");
    mkdirSync(home);
    const api = createApi({ home, dataDir: join(dir, "data"), cli: { command: process.execPath, args: [fake] }, version: "9.9.9" });
    server = createServer((rq, rs) => void api.handle(rq, rs));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server!.address() as AddressInfo).port;
    return { api, port, home };
  }

  function call(port: number, method: string, path: string, body?: string, onFirstChunk?: (abort: () => void) => void) {
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; text: string }>((done, fail) => {
      const r = request({ host: "127.0.0.1", port, method, path, headers: { origin: `http://127.0.0.1:${port}` } }, (res) => {
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

  it("answers health with the version", async () => {
    const { port } = await start();
    const r = await call(port, "GET", "/api/health");
    expect(JSON.parse(r.text)).toEqual({ ok: true, version: "9.9.9", scanning: false });
  });

  it("runs the CLI in your RawJobs folder", async () => {
    const { port, home } = await start();
    expect(realpathSync(JSON.parse((await call(port, "GET", "/api/setup")).text).cwd)).toBe(realpathSync(home));
  });

  it("saves your tracking in profile/tracking.json and reads it back", async () => {
    const { port, home } = await start();
    expect(JSON.parse((await call(port, "GET", "/api/tracking")).text)).toEqual({ tracking: null });
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
    const { port } = await start();
    const first = call(port, "POST", "/api/run", "{}");
    await new Promise((r) => setTimeout(r, 50));
    const second = await call(port, "POST", "/api/run", "{}");
    expect(second.text).toMatch(/already running/);
    expect((await first).text).toMatch(/"done"/);
  });
});
