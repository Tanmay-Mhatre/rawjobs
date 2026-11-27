import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectReports, openLog, readCrashes, recentCrashes, recordCrash, SAFE_MODE_CRASHES } from "../src/log";
import { backupData, startedSince } from "../src/update";
import { readScheduledRuns } from "../src/schedule";

const dir = () => mkdtempSync(join(tmpdir(), "rj-log-"));

describe("rotating logs", () => {
  it("moves the log to .1 (and .1 to .2) once a write takes it past the limit, keeping `keep` old files", () => {
    const file = join(dir(), "logs/run.log");
    const log = openLog(file, { maxBytes: 100, keep: 2 });
    for (let i = 0; i < 12; i++) log.write(`line ${i} ${"x".repeat(20)}`);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    expect(existsSync(`${file}.3`)).toBe(false);
    expect(statSync(file).size).toBeLessThanOrEqual(100);
    // Newest last: the current file ends with the last line written.
    expect(
      readFileSync(file, "utf8")
        .trim()
        .endsWith(`line 11 ${"x".repeat(20)}`),
    ).toBe(true);
  });

  it("rotates an oversized log when it's opened, and never throws when it can't write", () => {
    const d = dir();
    const file = join(d, "big.log");
    writeFileSync(file, "x".repeat(500));
    openLog(file, { maxBytes: 100 });
    expect(statSync(`${file}.1`).size).toBe(500);
    // A log whose folder is a file: writes fail quietly.
    writeFileSync(join(d, "notadir"), "");
    expect(() => openLog(join(d, "notadir/x.log")).write("hello")).not.toThrow();
  });
});

describe("crashes", () => {
  it("keeps the newest 20 with a short hash of the stack, and counts recent ones per process", () => {
    const d = dir();
    const now = Date.now();
    for (let i = 0; i < 22; i++) recordCrash(d, new Error(`boom ${i}`), { origin: "uncaughtException", where: "server", version: "1.0.0", now: new Date(now - i * 60_000) });
    const list = readCrashes(d);
    expect(list).toHaveLength(20);
    expect(list[0]).toMatchObject({ message: "boom 21", where: "server", version: "1.0.0" });
    expect(list[0]!.stackHash).toMatch(/^[0-9a-f]{12}$/);
    expect(recentCrashes(d, "server", now)).toBeGreaterThanOrEqual(SAFE_MODE_CRASHES);
    expect(recentCrashes(d, "scan", now)).toBe(0);
    expect(recentCrashes(d, "server", now + 3_600_000)).toBe(0);
  });

  it("writes the stack to the log too", () => {
    const d = dir();
    const log = openLog(join(d, "server.log"));
    recordCrash(d, new Error("kaboom"), { origin: "uncaughtException", where: "server", version: "1.0.0", log });
    expect(readFileSync(join(d, "server.log"), "utf8")).toMatch(/RawJobs crashed \(server, uncaughtException\): Error: kaboom/);
  });

  it("turns a fatal-error report into a crash entry once, at the time it happened, and keeps 3 reports", () => {
    const d = dir();
    mkdirSync(join(d, "reports"));
    for (let i = 0; i < 4; i++)
      writeFileSync(
        join(d, "reports", `report.2026112${i}.json`),
        JSON.stringify({ header: { event: "Allocation failed - JavaScript heap out of memory", trigger: "FatalError", dumpEventTime: `2026-11-2${i}T10:00:00Z` } }),
      );
    expect(collectReports(d, { where: "server", version: "1.0.0" })).toBe(4);
    expect(readCrashes(d)[0]).toMatchObject({ message: "Allocation failed - JavaScript heap out of memory", origin: "FatalError" });
    expect(readCrashes(d).map((c) => c.at)).toContain("2026-11-20T10:00:00.000Z");
    expect(collectReports(d, { where: "server", version: "1.0.0" })).toBe(0);
  });
});

describe("the update's start check across a log rotation", () => {
  it("finds the new version's start line after the offset, also when the log rotated meanwhile", () => {
    const home = dir();
    mkdirSync(join(home, "logs"));
    const file = join(home, "logs/server.log");
    writeFileSync(file, "old lines\nRawJobs 2.0.0 is starting.\n");
    const offset = statSync(file).size;
    expect(startedSince(home, offset, "2.0.0")).toBe(false);
    writeFileSync(file, `${readFileSync(file, "utf8")}RawJobs 2.0.0 is starting.\n`);
    expect(startedSince(home, offset, "2.0.0")).toBe(true);
    // Rotated: the old log is .1, the new one starts small.
    writeFileSync(`${file}.1`, "x".repeat(offset));
    writeFileSync(file, "RawJobs 3.0.0 is starting.\n");
    expect(startedSince(home, offset, "3.0.0")).toBe(true);
  });
});

describe("backups", () => {
  it("leave out the logs older versions kept in data/", async () => {
    const home = dir();
    mkdirSync(join(home, "data"));
    writeFileSync(join(home, "data/jobs.json"), "[]");
    writeFileSync(join(home, "data/schedule.log"), "lots of output");
    writeFileSync(join(home, "data/daily-summary.log"), "more output");
    const backup = await backupData(home, "test");
    expect(existsSync(join(backup, "data/jobs.json"))).toBe(true);
    expect(existsSync(join(backup, "data/schedule.log"))).toBe(false);
    expect(existsSync(join(backup, "data/daily-summary.log"))).toBe(false);
  });
});

describe("rawjobs --log", () => {
  it("a scheduled scan whose config can't be read logs why, in the log file and in the run list", () => {
    const home = dir();
    const data = join(home, "data");
    const log = join(home, "logs/schedule.log");
    const root = resolve(__dirname, "../../..");
    const r = spawnSync(
      process.execPath,
      [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "packages/cli/src/index.ts"), "scan", "--scheduled", "--config", join(home, "missing.yaml"), "--data", data, "--log", log],
      { encoding: "utf8", env: { ...process.env, RAWJOBS_HOME: home } },
    );
    expect(r.status).not.toBe(0);
    const text = readFileSync(log, "utf8");
    expect(text).toMatch(/rawjobs scan \(RawJobs .+\) started\./);
    expect(text).toMatch(/missing\.yaml/);
    expect(readScheduledRuns(data)[0]).toMatchObject({ ok: false, scope: "mine" });
    expect(readScheduledRuns(data)[0]!.error).toMatch(/^Your config can't be read: /);
  }, 60_000);
});
