import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WatchDeps } from "@rawjobs/core";
import { makeZip } from "../../core/test/fixtures/linkedin/make-zip";
import { createApi } from "../src/api";

const CONNECTIONS = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Lovelace,https://www.linkedin.com/in/ada-l,ada@example.com,Acme,Senior Product Manager,15 Oct 2020
Grace,Hopper,https://www.linkedin.com/in/grace-h,,Acme Inc.,Recruiter,03 Jan 2024
Alan,Turing,https://www.linkedin.com/in/alan-t,,Globex,Engineer,01 Feb 2023
`;
const POSITIONS = `Company Name,Title,Description,Location,Started On,Finished On
Initech,Product Manager,,Dubai,Jan 2019,Dec 2021
`;
const EDUCATION = `School Name,Start Date,End Date,Notes,Degree Name,Activities
State University,2012,2016,,BSc,
`;

describe("the network API", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  /** Timers the watcher set; a test runs them by hand. */
  let pending: (() => void)[] = [];
  let logs: string[] = [];

  async function start(watchDeps: Partial<WatchDeps> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-network-"));
    const home = join(dir, "home");
    const downloads = join(dir, "Downloads");
    mkdirSync(home);
    mkdirSync(downloads);
    mkdirSync(join(dir, "data"));
    pending = [];
    logs = [];
    // The CLI stand-in answers any command with "{}".
    const fake = join(dir, "fake-cli.mjs");
    writeFileSync(fake, `console.log("{}");`);
    const api = createApi({
      home,
      dataDir: join(dir, "data"),
      cli: { command: process.execPath, args: [fake] },
      version: "9.9.9",
      // Never the real Downloads folder: a temp one, and timers this test runs.
      watchDeps: { env: { RAWJOBS_DOWNLOADS: downloads }, schedule: (fn) => pending.push(fn), cancel: () => {}, log: (l) => logs.push(l), ...watchDeps },
    });
    server = createServer((rq, rs) => void api.handle(rq, rs));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return { port: (server!.address() as AddressInfo).port, home, downloads };
  }

  function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}) {
    // biome-ignore lint/suspicious/noExplicitAny: test answers are read field by field
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; text: string; json: () => any }>((done, fail) => {
      const r = request({ host: "127.0.0.1", port, method, path, headers: { origin: `http://127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => done({ status: res.statusCode!, headers: res.headers, text, json: () => JSON.parse(text) }));
      });
      r.on("error", fail);
      r.end(body);
    });
  }

  const importBody = (files: Record<string, string>, fileName = "Basic_LinkedInDataExport_10-20-2026.zip") => JSON.stringify({ fileName, files });

  it("imports the three CSVs, answers status, people and summary, and keeps no email", async () => {
    const { port, home } = await start();
    expect((await call(port, "GET", "/api/network")).json()).toEqual({ status: { connected: false, watch: null }, me: null, watchable: true });

    const r = await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS, positions: POSITIONS, education: EDUCATION }));
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({
      ok: true,
      status: { connected: true, counts: { connections: 3, positions: 1, education: 1, companies: 2 }, ageDays: 0, fileName: "Basic_LinkedInDataExport_10-20-2026.zip" },
    });

    const saved = readFileSync(join(home, "profile/network.json"), "utf8");
    expect(saved).not.toContain("ada@example.com");
    // Written whole: no temp file left behind.
    expect(readdirSync(join(home, "profile")).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const got = (await call(port, "GET", "/api/network")).json();
    expect(got.me).toEqual({ positions: [{ company: "Initech", title: "Product Manager", from: "2019-01", to: "2021-12" }], schools: [expect.objectContaining({ name: "State University" })] });

    const people = (await call(port, "GET", `/api/network/people?company=${encodeURIComponent("Acme")}`)).json();
    expect(people.how).toBe("exact");
    expect(people.people.map((p: { first: string }) => p.first)).toEqual(["Ada", "Grace"]);
    // Days since, never the date.
    expect(people.people[0].connectedOn).toBeUndefined();
    expect(people.people[0].connectedDays).toBeGreaterThan(365);
    expect(people.people[0]).toMatchObject({ id: "u:ada-l", friend: false, url: "https://www.linkedin.com/in/ada-l", position: "Senior Product Manager" });

    const summary = await call(port, "GET", "/api/network/summary");
    expect(summary.json().counts).toEqual({ acme: 2, globex: 1 });
    const tag = summary.headers.etag!;
    expect(tag).toBe(`"${summary.json().importedAt}"`);
    expect((await call(port, "GET", "/api/network/summary", undefined, { "if-none-match": tag })).status).toBe(304);
  });

  it("sends the privacy headers on every network answer", async () => {
    const { port } = await start();
    for (const [method, path] of [
      ["GET", "/api/network"],
      ["GET", "/api/network/summary"],
      ["GET", "/api/network/people?company=Acme"],
      ["GET", "/api/network/nope"],
    ] as const) {
      const r = await call(port, method, path);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["cross-origin-resource-policy"]).toBe("same-origin");
    }
  });

  it("answers bad imports with an error code, and an oversized body with 413", async () => {
    const { port } = await start();
    const noConnections = await call(port, "POST", "/api/network/import", importBody({ positions: POSITIONS }));
    expect(noConnections.status).toBe(400);
    expect(noConnections.json()).toEqual({ ok: false, errors: [{ code: "NO_CONNECTIONS" }] });
    expect((await call(port, "POST", "/api/network/import", "{ nope")).json().errors).toEqual([{ code: "BAD_REQUEST" }]);
    const big = await call(port, "POST", "/api/network/import", importBody({ connections: "x".repeat(12_000_001) }));
    expect(big.status).toBe(413);
    expect(big.json()).toEqual({ ok: false, errors: [{ code: "TOO_BIG" }] });
  });

  it("marks close contacts by a valid, known id, and keeps them across a re-import", async () => {
    const { port } = await start();
    await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS }));
    expect((await call(port, "PUT", "/api/network/friends", JSON.stringify({ id: "u:ada-l", friend: true }))).json()).toEqual({ ok: true });
    expect((await call(port, "PUT", "/api/network/friends", JSON.stringify({ id: "u:nobody", friend: true }))).status).toBe(404);
    expect((await call(port, "PUT", "/api/network/friends", JSON.stringify({ id: "../etc", friend: true }))).status).toBe(400);
    expect((await call(port, "PUT", "/api/network/friends", JSON.stringify({ id: "u:ada-l", friend: "yes" }))).status).toBe(400);

    await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS }));
    const people = (await call(port, "GET", "/api/network/people?company=Acme")).json().people;
    expect(people.find((p: { id: string }) => p.id === "u:ada-l").friend).toBe(true);
  });

  it("never echoes the company asked about in an error", async () => {
    const { port } = await start();
    const r = await call(port, "GET", `/api/network/people?company=${"<script>".repeat(40)}`);
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("script");
  });

  it("deletes the connections and the files next to them", async () => {
    const { port, home } = await start();
    await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS }));
    writeFileSync(join(home, "profile/network-watch.json"), "{}");
    writeFileSync(join(home, "profile/network.json.123.tmp"), "half");
    writeFileSync(join(home, "profile/tracking.json"), "{}");
    expect((await call(port, "DELETE", "/api/network")).json()).toEqual({ ok: true });
    expect(readdirSync(join(home, "profile"))).toEqual(["tracking.json"]);
    expect((await call(port, "GET", "/api/network")).json().status.connected).toBe(false);
    expect((await call(port, "GET", "/api/network/people?company=Acme")).json()).toEqual({ how: "none", people: [] });
  });

  it("starting setup over deletes the connections too", async () => {
    const { port, home } = await start();
    await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS }));
    expect(existsSync(join(home, "profile/network.json"))).toBe(true);
    await call(port, "POST", "/api/setup/reset");
    expect(existsSync(join(home, "profile/network.json"))).toBe(false);
  });

  it("leaves a file from a newer RawJobs alone", async () => {
    const { port, home } = await start();
    mkdirSync(join(home, "profile"));
    const newer = JSON.stringify({ app: "rawjobs", kind: "network", version: 2, importedAt: "2026-10-01T00:00:00.000Z", connections: [] });
    writeFileSync(join(home, "profile/network.json"), newer);
    expect((await call(port, "GET", "/api/network")).json().status).toEqual({ connected: false, watch: null, newer: true });
    expect((await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS }))).json().errors).toEqual([{ code: "NEWER_FILE" }]);
    expect(readFileSync(join(home, "profile/network.json"), "utf8")).toBe(newer);
  });

  it("sets a damaged file aside instead of failing", async () => {
    const { port, home } = await start();
    mkdirSync(join(home, "profile"));
    writeFileSync(join(home, "profile/network.json"), "{ broken");
    expect((await call(port, "GET", "/api/network")).json().status.connected).toBe(false);
    expect(existsSync(join(home, "profile/network.json.bad"))).toBe(true);
  });

  it("turns away writes from other sites (the existing guard)", async () => {
    const { port } = await start();
    expect((await call(port, "DELETE", "/api/network", undefined, { origin: "https://evil.example" })).status).toBe(403);
  });
  async function runTimers() {
    const fns = pending;
    pending = [];
    for (const fn of fns) fn();
    // The poll reads the folder and the ZIP asynchronously.
    await new Promise((r) => setTimeout(r, 200));
  }

  it("watches Downloads: start, state in GET, import from the folder, and stop", async () => {
    const { port, home, downloads } = await start();
    const r = await call(port, "POST", "/api/network/watch", "{}");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["cross-origin-resource-policy"]).toBe("same-origin");
    const watch = r.json().watch;
    expect(watch).toMatchObject({ folder: "Downloads" });
    expect(Date.parse(watch.until) - Date.parse(watch.since)).toBe(24 * 3_600_000);
    expect((await call(port, "GET", "/api/network")).json().status.watch).toEqual(watch);
    expect(existsSync(join(home, "profile/network-watch.json"))).toBe(true);

    writeFileSync(join(downloads, "Basic_LinkedInDataExport_10-20-2026.zip"), makeZip([{ name: "Connections.csv", data: CONNECTIONS }]));
    await runTimers();
    const after = (await call(port, "GET", "/api/network")).json().status;
    expect(after).toMatchObject({ connected: true, source: "downloads", fileName: "Basic_LinkedInDataExport_10-20-2026.zip", watch: null });
    expect(logs.some((l) => l.startsWith("Found Basic_LinkedInDataExport_10-20-2026.zip ("))).toBe(true);
    expect(logs.join(" ")).not.toContain(downloads);
  });

  it("DELETE /api/network/watch stops it, and so does choosing the file yourself", async () => {
    const { port, home } = await start();
    await call(port, "POST", "/api/network/watch");
    expect((await call(port, "DELETE", "/api/network/watch")).json()).toEqual({ ok: true });
    expect(existsSync(join(home, "profile/network-watch.json"))).toBe(false);
    expect((await call(port, "GET", "/api/network")).json().status.watch).toBeNull();

    await call(port, "POST", "/api/network/watch");
    const imp = await call(port, "POST", "/api/network/import", importBody({ connections: CONNECTIONS }));
    expect(imp.json().status.watch).toBeNull();
    expect(existsSync(join(home, "profile/network-watch.json"))).toBe(false);
  });

  it("answers NO_ACCESS when Downloads can't be read, and isn't offered on macOS", async () => {
    const denied = await start({ readdir: () => Promise.reject(Object.assign(new Error("EPERM"), { code: "EPERM" })) });
    const r = await call(denied.port, "POST", "/api/network/watch");
    expect(r.status).toBe(400);
    expect(r.json()).toEqual({ watch: null, error: "NO_ACCESS" });
    server?.close();

    const mac = await start({ platform: "darwin", env: {} });
    expect((await call(mac.port, "GET", "/api/network")).json().watchable).toBe(false);
    expect((await call(mac.port, "POST", "/api/network/watch")).json()).toEqual({ watch: null, error: "UNSUPPORTED" });
  });

  it("refuses a watch started from another site", async () => {
    const { port } = await start();
    expect((await call(port, "POST", "/api/network/watch", "{}", { origin: "https://evil.example" })).status).toBe(403);
  });
});
