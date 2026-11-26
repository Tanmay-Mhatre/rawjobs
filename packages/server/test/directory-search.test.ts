import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api";
import { directorySearch } from "../src/directory-search";

let dir = "";
let server: Server | undefined;
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * A stand-in CLI: `directory search --serve` answers each line with what it was asked (slowly for
 * "slow"); every start and every other command is logged to log.txt.
 */
function fakeCli() {
  dir = mkdtempSync(join(tmpdir(), "rawjobs-search-"));
  const log = join(dir, "log.txt");
  const fake = join(dir, "fake-cli.mjs");
  writeFileSync(
    fake,
    `import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, args.slice(0, 3).join(" ") + "\\n");
if (args.includes("--serve")) {
  for await (const line of createInterface({ input: process.stdin })) {
    const m = JSON.parse(line);
    if (m.q === "crash") process.exit(1);
    const send = () => process.stdout.write(JSON.stringify(m.q === "bad" ? { id: m.id, ok: false, error: "no good" } : { id: m.id, ok: true, answer: { op: m.op, q: m.q, page: m.page } }) + "\\n");
    if (m.q === "slow") setTimeout(send, 200);
    else send();
  }
} else {
  console.log(JSON.stringify({ args }));
}`,
  );
  return { fake, log };
}

const starts = (log: string) =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l === "directory search --serve").length;

describe("directorySearch", () => {
  it("keeps one process for every request, answers by id, and stops it when idle", async () => {
    const { fake, log } = fakeCli();
    const s = directorySearch(() => spawn(process.execPath, [fake, "directory", "search", "--serve"]), { idleMs: 300 });
    stops.push(s.stop);
    const [slow, quick] = await Promise.all([s.ask("search", { q: "slow" }), s.ask("search", { q: "quick", page: 2 })]);
    expect(slow).toEqual({ op: "search", q: "slow" });
    expect(quick).toEqual({ op: "search", q: "quick", page: 2 });
    expect(await s.ask("names", { keys: [] })).toEqual({ op: "names" });
    expect(starts(log)).toBe(1);
    await expect(s.ask("search", { q: "bad" })).rejects.toThrow("no good");
    // Idle: stopped (its memory freed), and started again by the next request.
    for (let i = 0; i < 100 && s.running(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(s.running()).toBe(false);
    expect(await s.ask("search", { q: "again" })).toEqual({ op: "search", q: "again" });
    expect(starts(log)).toBe(2);
  });

  it("fails what's waiting when the process stops, then starts a new one", async () => {
    const { fake, log } = fakeCli();
    const s = directorySearch(() => spawn(process.execPath, [fake, "directory", "search", "--serve"]));
    stops.push(s.stop);
    await expect(s.ask("search", { q: "crash" })).rejects.toThrow(/stopped/);
    expect(await s.ask("search", { q: "fine" })).toEqual({ op: "search", q: "fine" });
    expect(starts(log)).toBe(2);
  });

  it("gives up on an answer that takes too long", async () => {
    const { fake } = fakeCli();
    const s = directorySearch(() => spawn(process.execPath, [fake, "directory", "search", "--serve"]), { timeoutMs: 50 });
    stops.push(s.stop);
    await expect(s.ask("search", { q: "slow" })).rejects.toThrow(/too long/);
  });
});

describe("/api/directory/search", () => {
  function call(port: number, path: string, body: string, method = "POST") {
    return new Promise<{ status: number; text: string }>((done, fail) => {
      const r = request({ host: "127.0.0.1", port, method, path, headers: { origin: `http://127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => done({ status: res.statusCode ?? 0, text }));
      });
      r.on("error", fail);
      r.end(body);
    });
  }

  it("answers Browse all from the search process, without clearing the kept answers", async () => {
    const { fake, log } = fakeCli();
    const home = join(dir, "home");
    const dataDir = join(dir, "data");
    mkdirSync(home);
    mkdirSync(join(dataDir, "catalog"), { recursive: true });
    const api = createApi({ home, dataDir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9" });
    stops.push(() => api.stop(0));
    server = createServer((rq, rs) => void api.handle(rq, rs));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    expect(JSON.parse((await call(port, "/api/directory/search", JSON.stringify({ q: "acme", page: 3 }))).text)).toEqual({ op: "search", q: "acme", page: 3 });
    expect(JSON.parse((await call(port, "/api/directory/names", JSON.stringify({ keys: ["a"] }))).text)).toEqual({ op: "names" });
    expect(JSON.parse((await call(port, "/api/directory/warm", "{}")).text)).toEqual({ op: "warm" });
    expect((await call(port, "/api/directory/search", "not json")).status).toBe(400);
    expect((await call(port, "/api/directory/search", "[1]")).status).toBe(400);
    expect((await call(port, "/api/directory/search", JSON.stringify({ q: "bad" }))).status).toBe(503);

    // GET /api/directory is read by the CLI once and kept: searching doesn't make it read again.
    appendFileSync(log, "");
    await call(port, "/api/directory", "", "GET");
    await call(port, "/api/directory/search", JSON.stringify({ q: "x" }));
    await call(port, "/api/directory", "", "GET");
    expect(
      readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l.startsWith("directory status")).length,
    ).toBe(1);
    expect(starts(log)).toBe(1);
  });
});

describe("POST /api/directory/update", () => {
  it("shares one run between two clicks instead of starting a second download", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-dirupdate-"));
    const log = join(dir, "log.txt");
    const fake = join(dir, "fake-cli.mjs");
    // A slow update: logs when it starts and ends, so overlapping runs show up.
    writeFileSync(
      fake,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, "start " + args.join(" ") + "\\n");
setTimeout(() => { appendFileSync(${JSON.stringify(log)}, "end\\n"); console.log(JSON.stringify({ updated: true, message: "ok" })); }, 300);`,
    );
    const home = join(dir, "home");
    const dataDir = join(dir, "data");
    mkdirSync(home);
    mkdirSync(join(dataDir, "catalog"), { recursive: true });
    const api = createApi({ home, dataDir, cli: { command: process.execPath, args: [fake] }, version: "9.9.9" });
    stops.push(() => api.stop(0));
    server = createServer((rq, rs) => void api.handle(rq, rs));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    const post = () =>
      new Promise<string>((done, fail) => {
        const r = request({ host: "127.0.0.1", port, method: "POST", path: "/api/directory/update", headers: { origin: `http://127.0.0.1:${port}` } }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (d) => (text += d));
          res.on("end", () => done(text));
        });
        r.on("error", fail);
        r.end();
      });
    const [a, b] = await Promise.all([post(), post()]);
    expect(JSON.parse(a)).toEqual({ updated: true, message: "ok" });
    expect(b).toBe(a);
    const lines = readFileSync(log, "utf8").trim().split(/\r?\n/);
    expect(lines).toEqual([`start directory update --json --data ${dataDir}`, "end"]);
  });
});
