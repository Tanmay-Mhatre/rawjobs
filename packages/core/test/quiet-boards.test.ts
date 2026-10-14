import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type BoardHealth, type BoardRecord, hashIds, isQuiet, planBoards, quietHours, readBoardHealth, recordBoards, writeBoardHealth } from "../src/board-health";
import { parseConfig } from "../src/config";
import { readLedger } from "../src/discover";
import { runRadar } from "../src/run";
import { scan, type ScanStart } from "../src/scan";
import type { CompanyHealth } from "../src/schema";
import { readJobs } from "../src/store";
import { company, fakeHttp, fixture, json } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = Date.parse("2026-10-03T12:00:00Z");

const steady = (sameDays: number, fetchedHoursAgo: number, o: Partial<BoardRecord> = {}): BoardRecord => ({ okAt: T - fetchedHoursAgo * HOUR, ids: "abcd1234", changedAt: T - sameDays * DAY, ...o });
const health = (key: string, o: Partial<CompanyHealth> = {}): CompanyHealth => {
  const [ats, slug] = key.split(":") as [CompanyHealth["ats"], string];
  return { company: slug, ats, slug, key, ok: true, jobsFound: 1, matches: 0, durationMs: 1, ...o };
};

describe("quiet boards", () => {
  it("are fetched every scan for two weeks, then once a day, then every 3 days from 45 days", () => {
    expect([0, 13, 14, 44, 45, 200].map((d) => quietHours(steady(d, 0), T))).toEqual([0, 0, 24, 24, 72, 72]);
  });

  it("are left alone until their interval since the last fetch that worked is over", () => {
    expect(isQuiet(steady(20, 23), T)).toBe(true);
    expect(isQuiet(steady(20, 25), T)).toBe(false);
    expect(isQuiet(steady(50, 70), T)).toBe(true);
    expect(isQuiet(steady(50, 73), T)).toBe(false);
    expect(isQuiet(steady(5, 1), T)).toBe(false);
  });

  it("a board whose change was never recorded, or that's failing, isn't quiet", () => {
    expect(isQuiet({ okAt: T - HOUR }, T)).toBe(false);
    expect(isQuiet(steady(50, 1, { fails: 1, failedAt: T - 10 * HOUR }), T)).toBe(false);
  });

  it("your own companies are always fetched", () => {
    const h: BoardHealth = { version: 1, boards: { "greenhouse:mine": steady(60, 1), "greenhouse:dir": steady(60, 1) } };
    const mine = company("greenhouse", { slug: "mine" });
    const dir = company("greenhouse", { slug: "dir" });
    expect(planBoards([mine, dir], h, T, { yours: new Set(["greenhouse:mine"]) })).toEqual({ fetch: [mine], resting: [], quiet: [dir] });
  });
});

describe("recording job changes", () => {
  it("starts the clock at the first full read, keeps it while the jobs stay the same, and moves it when they change", () => {
    let h: BoardHealth = { version: 1, boards: {} };
    h = recordBoards(h, [health("greenhouse:a", { idsHash: "1111" })], T);
    expect(h.boards["greenhouse:a"]).toEqual({ okAt: T, ids: "1111", changedAt: T });
    h = recordBoards(h, [health("greenhouse:a", { idsHash: "1111" })], T + DAY);
    expect(h.boards["greenhouse:a"]).toEqual({ okAt: T + DAY, ids: "1111", changedAt: T });
    h = recordBoards(h, [health("greenhouse:a", { idsHash: "2222" })], T + 2 * DAY);
    expect(h.boards["greenhouse:a"]).toEqual({ okAt: T + 2 * DAY, ids: "2222", changedAt: T + 2 * DAY });
  });

  it("a partial read or a failure says nothing about changes", () => {
    let h: BoardHealth = { version: 1, boards: { "greenhouse:a": steady(20, 30) } };
    h = recordBoards(h, [health("greenhouse:a", { partial: true })], T);
    expect(h.boards["greenhouse:a"]).toMatchObject({ okAt: T, ids: "abcd1234", changedAt: T - 20 * DAY });
    h = recordBoards(h, [health("greenhouse:a", { ok: false, failure: "timeout" })], T + HOUR);
    expect(h.boards["greenhouse:a"]).toMatchObject({ fails: 1, ids: "abcd1234", changedAt: T - 20 * DAY });
  });

  it("hashes the job ids, whatever their order", () => {
    expect(hashIds(["a:1", "a:2"])).toBe(hashIds(["a:2", "a:1"]));
    expect(hashIds(["a:1", "a:2"])).not.toBe(hashIds(["a:1", "a:3"]));
    expect(hashIds(["a:1", "a:2"])).toMatch(/^[0-9a-f]{8}$/);
  });

  it("a scan notes the hash only when it read the whole list", async () => {
    const cfg = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "GH Co", ats: greenhouse, slug: "ghco" }
`);
    const r = await runRadar(cfg, { http: fakeHttp(() => json(fixture("greenhouse.json"))).http, now: new Date(T) });
    expect(r.health[0]!.idsHash).toBe(hashIds(r.jobs.map((j) => j.id)));
  });
});

describe("scan with quiet boards", () => {
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
    dir = mkdtempSync(join(tmpdir(), "rawjobs-quiet-"));
    mkdirSync(join(dir, "catalog"));
    const entry = (ats: string, slug: string) => ({ key: `${ats}:${slug}`, name: slug, ats, slug, careers_url: `https://x/${slug}`, open_jobs: 5, status: "live", tags: ["crypto"] });
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("greenhouse", "ghco"), entry("lever", "leverco")] }));
  };
  const ok = (url: string) => (url.includes("greenhouse") ? json(fixture("greenhouse.json")) : json(fixture("lever.json")));
  /** Pretend both boards' jobs have been the same for `days`. */
  const ageBoards = (days: number) => {
    const h = readBoardHealth(dir);
    for (const r of Object.values(h.boards)) r.changedAt = T - days * DAY;
    writeBoardHealth(dir, h);
  };
  const leverJobs = () => readJobs(dir).filter((j) => j.id.startsWith("lever:leverco:"));

  it("skips a quiet directory board between its fetches, keeps its jobs, and still fetches yours", async () => {
    setup();
    await scan(config(), { dataDir: dir, http: fakeHttp(ok).http, now: new Date(T), feed: false });
    const before = leverJobs();
    expect(before.length).toBeGreaterThan(0);
    ageBoards(20);

    const quiet = fakeHttp(ok);
    const starts: ScanStart[] = [];
    const r = await scan(config(), { dataDir: dir, http: quiet.http, now: new Date(T + 2 * HOUR), feed: false, onStart: (s) => starts.push(s) });
    expect(quiet.calls.some((u) => u.includes("leverco"))).toBe(false);
    expect(quiet.calls.some((u) => u.includes("greenhouse"))).toBe(true);
    expect(starts[0]).toMatchObject({ extra: 0, quiet: 1 });
    expect(r.quiet).toBe(1);
    expect(r.resting).toBe(0);
    // Untouched: still open, no missed run, still remembered; and quiet isn't a failure.
    expect(leverJobs()).toEqual(before);
    expect(readLedger(dir).companies["lever:leverco"]).toBeDefined();
    expect(readBoardHealth(dir).boards["lever:leverco"]?.fails).toBeUndefined();

    const dayLater = fakeHttp(ok);
    await scan(config(), { dataDir: dir, http: dayLater.http, now: new Date(T + 25 * HOUR), feed: false });
    expect(dayLater.calls.some((u) => u.includes("leverco"))).toBe(true);
  });

  it("after 45 days the same, every 3 days", async () => {
    setup();
    await scan(config(), { dataDir: dir, http: fakeHttp(ok).http, now: new Date(T), feed: false });
    ageBoards(50);
    const twoDays = fakeHttp(ok);
    await scan(config(), { dataDir: dir, http: twoDays.http, now: new Date(T + 48 * HOUR), feed: false });
    expect(twoDays.calls.some((u) => u.includes("leverco"))).toBe(false);
    const threeDays = fakeHttp(ok);
    await scan(config(), { dataDir: dir, http: threeDays.http, now: new Date(T + 73 * HOUR), feed: false });
    expect(threeDays.calls.some((u) => u.includes("leverco"))).toBe(true);
  });

  it("checking chosen companies fetches a quiet board anyway", async () => {
    setup();
    await scan(config(), { dataDir: dir, http: fakeHttp(ok).http, now: new Date(T), feed: false });
    ageBoards(20);
    const check = fakeHttp(ok);
    await scan(config(), { dataDir: dir, http: check.http, now: new Date(T + HOUR), checkKeys: ["lever:leverco"] });
    expect(check.calls.some((u) => u.includes("leverco"))).toBe(true);
  });

  it("works the same for a scan of the whole directory", async () => {
    setup();
    await scan(config(), { dataDir: dir, http: fakeHttp(ok).http, now: new Date(T), feed: false, scope: "all" });
    ageBoards(20);
    const all = fakeHttp(ok);
    const r = await scan(config(), { dataDir: dir, http: all.http, now: new Date(T + HOUR), feed: false, scope: "all" });
    expect(all.calls.some((u) => u.includes("leverco"))).toBe(false);
    expect(r.quiet).toBe(1);
  });
});
