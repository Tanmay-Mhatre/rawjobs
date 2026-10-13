import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api";
import { refuse } from "../src/guard";
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
    expect(JSON.parse(r.text)).toEqual({ ok: true, version: "9.9.9", scanning: false, update: null, startLink: false, platform: process.platform });
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
      ["GET", "/api/setup", ["setup", "status", "--data", dataDir]],
      ["POST", "/api/setup/config", ["setup", "save"], '{"profile":{}}'],
      ["POST", "/api/setup/reset", ["setup", "reset"]],
      ["GET", "/api/setup/resume", ["setup", "resume"]],
      ["POST", "/api/setup/resume", ["setup", "resume", "save"], "# Resume"],
      ["DELETE", "/api/setup/resume", ["setup", "resume", "delete"]],
      ["POST", "/api/setup/check", ["setup", "check", "--data", dataDir], '{"urls":["https://jobs.lever.co/acme"]}'],
      ["GET", "/api/directory", ["directory", "status", "--json", "--data", dataDir]],
      ["POST", "/api/directory/update", ["directory", "update", "--json", "--data", dataDir]],
      ["GET", "/api/scan/plan", ["scan", "--plan", "--data", dataDir]],
      ["GET", "/api/alerts/telegram", ["alerts", "telegram", "status"]],
      ["POST", "/api/alerts/telegram/token", ["alerts", "telegram", "token"], '{"token":"x"}'],
      ["POST", "/api/alerts/telegram/forget", ["alerts", "telegram", "forget"]],
      ["GET", "/api/schedule", ["schedule", "status", "--data", dataDir]],
      ["POST", "/api/schedule", ["schedule", "install", "--stdin", "--data", dataDir], '{"times":["08:00"]}'],
      ["DELETE", "/api/schedule", ["schedule", "remove", "--data", dataDir]],
      ["POST", "/api/schedule/run", ["schedule", "run", "--data", dataDir]],
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

  it("answers what it can't do: no company to check, an unknown route, stop or notify with no scan", async () => {
    const { port } = await start();
    expect((await call(port, "POST", "/api/check", '{"keys":["not a key"]}')).status).toBe(400);
    expect((await call(port, "GET", "/api/nothing-here")).status).toBe(404);
    expect(JSON.parse((await call(port, "POST", "/api/run/stop")).text)).toEqual({ ok: false });
    expect(JSON.parse((await call(port, "POST", "/api/run/notify")).text)).toEqual({ ok: false });
  });

  it("asks a running scan to stop, or to send its message, through files the scan checks", async () => {
    const { api, port, dataDir } = await start();
    const run = call(port, "POST", "/api/run", "{}");
    await until(() => api.scanning());
    expect(JSON.parse((await call(port, "POST", "/api/run/notify")).text)).toEqual({ ok: true });
    expect(existsSync(join(dataDir, "scan-notify"))).toBe(true);
    expect(JSON.parse((await call(port, "POST", "/api/run/stop")).text)).toEqual({ ok: true });
    expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
    await run;
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
    await until(() => existsSync(log) && readFileSync(log, "utf8").split("\n").length > 2);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["directory update", "companies suggest"]);
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
