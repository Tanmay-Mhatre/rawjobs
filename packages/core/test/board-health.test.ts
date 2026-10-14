import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type BoardHealth, type BoardRecord, isChronic, isResting, planBoards, pruneBoards, readBoardHealth, recordBoards, restHours, writeBoardHealth } from "../src/board-health";
import { parseConfig } from "../src/config";
import { BoardClosedError } from "../src/connectors/parse";
import { mergeHistory } from "../src/diff";
import { HostSkippedError, HttpError } from "../src/http";
import { failureOf, type RunResult } from "../src/run";
import { scan, type ScanStart } from "../src/scan";
import type { CompanyHealth, Job } from "../src/schema";
import { readJobs } from "../src/store";
import { company, fakeHttp, fixture, json, makeJob } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = Date.parse("2026-10-03T12:00:00Z");

const failing = (fails: number, o: Partial<BoardRecord> = {}): BoardRecord => ({ fails, since: T - HOUR, failedAt: T, reason: "server", ...o });
const health = (key: string, o: Partial<CompanyHealth> = {}): CompanyHealth => {
  const [ats, slug] = key.split(":") as [CompanyHealth["ats"], string];
  return { company: slug, ats, slug, key, ok: true, jobsFound: 1, matches: 0, durationMs: 1, ...o };
};

describe("rest after failures", () => {
  it("doubles from an hour, up to a day", () => {
    expect([1, 2, 3, 4, 5, 6, 12].map((n) => restHours(failing(n), T))).toEqual([1, 2, 4, 8, 16, 24, 24]);
    expect(restHours(undefined, T)).toBe(0);
    expect(restHours({ okAt: T }, T)).toBe(0);
  });

  it("is at most 6 hours for your own companies", () => {
    expect([1, 3, 4, 12].map((n) => restHours(failing(n), T, true))).toEqual([1, 4, 6, 6]);
  });

  it("is the full day for a board that hasn't worked for 30 days (but still 6 hours for yours)", () => {
    const chronic = failing(2, { since: T - 31 * DAY });
    expect(isChronic(chronic, T)).toBe(true);
    expect(isChronic(failing(2, { since: T - 29 * DAY }), T)).toBe(false);
    expect(restHours(chronic, T)).toBe(24);
    expect(restHours(chronic, T, true)).toBe(6);
  });

  it("rests from the last failure until the rest is over", () => {
    const r = failing(3, { failedAt: T - 3 * HOUR });
    expect(isResting(r, T)).toBe(true);
    expect(isResting(r, T + HOUR)).toBe(false);
    expect(isResting({ okAt: T }, T)).toBe(false);
    expect(isResting(failing(12, { failedAt: T - 7 * HOUR }), T, true)).toBe(false);
  });

  it("plans resting boards out, except ones a stopped scan already did", () => {
    const h: BoardHealth = { version: 1, boards: { "greenhouse:a": failing(1), "greenhouse:b": { okAt: T } } };
    const a = company("greenhouse", { slug: "a" });
    const b = company("greenhouse", { slug: "b" });
    expect(planBoards([a, b], h, T)).toEqual({ fetch: [b], resting: [a] });
    expect(planBoards([a, b], h, T, { done: new Set(["greenhouse:a"]) })).toEqual({ fetch: [a, b], resting: [] });
  });
});

describe("recordBoards", () => {
  it("counts failures in a row, keeping when they started and what kind they are", () => {
    let h: BoardHealth = { version: 1, boards: {} };
    h = recordBoards(h, [health("greenhouse:a", { ok: false, failure: "timeout" })], T);
    h = recordBoards(h, [health("greenhouse:a", { ok: false, failure: "gone" })], T + HOUR);
    expect(h.boards["greenhouse:a"]).toEqual({ fails: 2, since: T, failedAt: T + HOUR, reason: "gone" });
  });

  it("a fetch that works ends the failures", () => {
    let h: BoardHealth = { version: 1, boards: { "greenhouse:a": failing(5, { okAt: T - 10 * DAY }) } };
    h = recordBoards(h, [health("greenhouse:a")], T + HOUR);
    expect(h.boards["greenhouse:a"]).toEqual({ okAt: T + HOUR });
    expect(isResting(h.boards["greenhouse:a"], T + HOUR)).toBe(false);
  });

  it("records nothing when no request was made", () => {
    const h = recordBoards({ version: 1, boards: {} }, [health("kenexa:bank", { ok: false, unsupported: true }), health("greenhouse:a", { ok: false })], T);
    expect(h.boards).toEqual({});
  });

  it("drops boards out of scope 60 days after their last fetch", () => {
    const h: BoardHealth = { version: 1, boards: { "greenhouse:old": { okAt: T - 61 * DAY }, "greenhouse:recent": { okAt: T - 10 * DAY }, "greenhouse:mine": { okAt: T - 90 * DAY } } };
    expect(Object.keys(pruneBoards(h, new Set(["greenhouse:mine"]), T).boards).sort()).toEqual(["greenhouse:mine", "greenhouse:recent"]);
  });
});

describe("failureOf", () => {
  it("calls only a definite answer gone", () => {
    expect(failureOf(new HttpError("HTTP 404", "u", 404))).toBe("gone");
    expect(failureOf(new HttpError("HTTP 410", "u", 410))).toBe("gone");
    expect(failureOf(new BoardClosedError("BambooHR", "acme", "no longer exists"))).toBe("gone");
    expect(failureOf(new HttpError("HTTP 503", "u", 503))).toBe("server");
    expect(failureOf(new HttpError("HTTP 429", "u", 429))).toBe("server");
    expect(failureOf(new HttpError("timed out after 15s (u)", "u"))).toBe("timeout");
    expect(failureOf(new HttpError("fetch failed (u)", "u"))).toBe("network");
    expect(failureOf(new Error("boom"))).toBe("other");
    expect(failureOf(new HostSkippedError("skipped: host failed 3 times in a row (u)", "u"))).toBeUndefined();
  });
});

describe("board-health.json", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is written whole, with no temp file left behind", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-boards-"));
    const h: BoardHealth = { version: 1, boards: { "greenhouse:a": failing(2) } };
    writeBoardHealth(dir, h);
    expect(readBoardHealth(dir)).toEqual(h);
    expect(readdirSync(dir)).toEqual(["board-health.json"]);
  });

  it("survives a crash mid-write: a leftover temp file is ignored, a damaged file is set aside", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-boards-"));
    const file = join(dir, "board-health.json");
    writeBoardHealth(dir, { version: 1, boards: { "greenhouse:a": { okAt: T } } });
    writeFileSync(`${file}.1234.tmp`, '{"version":1,"boa');
    expect(readBoardHealth(dir).boards).toEqual({ "greenhouse:a": { okAt: T } });
    writeFileSync(file, '{"version":1,"boa');
    expect(readBoardHealth(dir)).toEqual({ version: 1, boards: {} });
    expect(existsSync(`${file}.bad`)).toBe(true);
  });
});

describe("a skipped board's jobs", () => {
  it("stay as they are in history: no missed run, nothing closed", () => {
    const at = "2026-10-03T12:00:00.000Z";
    const job = makeJob({ id: "greenhouse:acme:1", firstSeen: at, lastSeen: at, missedRuns: 1 });
    // A resting board has no health row this run: not fetched, so not "fetched ok" either.
    const run: RunResult = { startedAt: at, finishedAt: at, jobs: [], health: [], partial: false, checked: 0 };
    const m = mergeHistory([job], run, [{ ats: "greenhouse", slug: "acme" }]);
    expect(m.jobs).toEqual([job]);
    expect(m.closedIds.size).toBe(0);
  });
});

describe("scan with resting boards", () => {
  const config = () =>
    parseConfig(`
profile:
  titles: { include: ["product manager", "head of product"] }
  locations: { include: ["dubai", "abu dhabi"], remote_ok: ["emea"] }
  industries: ["crypto"]
companies:
  - { name: "GH Co", ats: greenhouse, slug: "ghco" }
`);
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-boards-"));
    mkdirSync(join(dir, "catalog"));
    const entry = (ats: string, slug: string) => ({ key: `${ats}:${slug}`, name: slug, ats, slug, careers_url: `https://x/${slug}`, open_jobs: 5, status: "live", tags: ["crypto"] });
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("greenhouse", "ghco"), entry("lever", "leverco")] }));
  };
  const ok = (url: string) => (url.includes("greenhouse") ? json(fixture("greenhouse.json")) : json(fixture("lever.json")));
  const down = (url: string) => (url.includes("greenhouse") ? json({ error: "busy" }, 503) : ok(url));
  const at = (ms: number) => new Date(T + ms);
  const ghOpen = (jobs: readonly Job[]) => jobs.filter((j) => j.company === "GH Co").map((j) => [j.status, j.missedRuns ?? 0]);

  it("leaves a failing board of yours alone until its rest is over, keeping its jobs", async () => {
    setup();
    await scan(config(), { dataDir: dir, http: fakeHttp(ok).http, now: at(0), feed: false });
    const before = ghOpen(readJobs(dir));
    expect(before.length).toBe(3);

    await scan(config(), { dataDir: dir, http: fakeHttp(down).http, now: at(HOUR), feed: false });
    expect(readBoardHealth(dir).boards["greenhouse:ghco"]).toMatchObject({ fails: 1, reason: "server" });

    const resting = fakeHttp(ok);
    const starts: ScanStart[] = [];
    const r = await scan(config(), { dataDir: dir, http: resting.http, now: at(HOUR + 30 * 60_000), feed: false, onStart: (s) => starts.push(s) });
    expect(resting.calls.some((u) => u.includes("greenhouse"))).toBe(false);
    expect(starts[0]).toMatchObject({ yours: [], resting: 1 });
    expect(r.resting).toBe(1);
    expect(ghOpen(readJobs(dir))).toEqual(before);

    // "Check now"-style scans of chosen companies fetch it anyway.
    const only = fakeHttp(ok);
    await scan(config(), { dataDir: dir, http: only.http, now: at(HOUR + 40 * 60_000), only: ["GH Co"] });
    expect(only.calls.some((u) => u.includes("greenhouse"))).toBe(true);
    expect(readBoardHealth(dir).boards["greenhouse:ghco"]).toEqual({ okAt: T + HOUR + 40 * 60_000 });
  });

  it("tries again once the rest is over", async () => {
    setup();
    writeBoardHealth(dir, { version: 1, boards: { "greenhouse:ghco": failing(1, { failedAt: T - 2 * HOUR }), "lever:leverco": failing(3, { failedAt: T - 2 * HOUR }) } });
    const { http, calls } = fakeHttp(ok);
    const r = await scan(config(), { dataDir: dir, http, now: at(0), feed: false });
    expect(calls.some((u) => u.includes("greenhouse"))).toBe(true);
    // The directory board rests 4 hours after its third failure.
    expect(calls.some((u) => u.includes("leverco"))).toBe(false);
    expect(r.checks).toEqual([]);
    expect(r.resting).toBe(1);
    expect(readBoardHealth(dir).boards["greenhouse:ghco"]).toEqual({ okAt: T });
  });

  it("names boards that haven't worked for 30 days", async () => {
    setup();
    writeBoardHealth(dir, { version: 1, boards: { "greenhouse:ghco": failing(40, { since: T - 40 * DAY, failedAt: T - 7 * HOUR }) } });
    const r = await scan(config(), { dataDir: dir, http: fakeHttp(down).http, now: at(0), feed: false });
    expect(r.chronic).toEqual(["GH Co (greenhouse:ghco)"]);
    expect(JSON.parse(readFileSync(join(dir, "board-health.json"), "utf8")).boards["greenhouse:ghco"]).toMatchObject({ fails: 41, since: T - 40 * DAY });
  });
});
