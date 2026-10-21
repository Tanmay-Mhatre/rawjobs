import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { readLedger } from "../src/discover";
import { readProgress, resumable, scan, type ScanStart } from "../src/scan";
import { estimateScan, estimateSeconds, readSpeeds, recordSpeeds, scopeCompanies, type DirectoryEntry } from "../src/scope";
import { fakeHttp, fixture, json } from "./helpers";
import type { DataMeta } from "../src/schema";

const now = new Date("2026-10-03T12:00:00Z");

const config = (yaml = "") =>
  parseConfig(`
profile:
  titles: { include: ["product manager", "head of product"], exclude: ["product marketing"] }
  seniority_boost: ["senior", "head", "group"]
  locations: { include: ["dubai", "abu dhabi"], remote_ok: ["emea"], remote_exclude: ["us"] }
  keywords: { crypto: 5, exchange: 4, payments: 3, tokenization: 5 }
  industries: ["crypto"]
companies:
  - { name: "GH Co", ats: greenhouse, slug: "ghco" }
${yaml}`);

const entry = (key: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry => {
  const [ats, slug] = key.split(":") as [string, string];
  return { key, name: slug, ats, slug, careers_url: `https://careers.example/${slug}`, open_jobs: 5, status: "live", ...extra };
};

const DIRECTORY = [
  entry("greenhouse:ghco", { name: "GH Co", tags: ["crypto"] }),
  entry("lever:leverco", { tags: ["crypto"] }),
  entry("ashby:quiet", { tags: ["payments"] }),
  entry("ashby:mutedco", { tags: ["crypto"] }),
  entry("kenexa:bank", { tags: ["crypto"] }), // a hiring system we can't read
  entry("lever:sleepy", { tags: ["crypto"], status: "dormant" }),
];

const setup = (directory = DIRECTORY) => {
  const dir = mkdtempSync(join(tmpdir(), "jh-scan-"));
  mkdirSync(join(dir, "catalog"));
  writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: directory }));
  return dir;
};
const routes = (url: string) => {
  if (url.includes("greenhouse")) return json(fixture("greenhouse.json"));
  if (url.includes("lever.co/v0/postings/leverco")) return json(fixture("lever.json"));
  return json({ error: "not found" }, 404);
};

describe("scopeCompanies", () => {
  const cfg = config(`companies_muted: ["ashby:mutedco"]`);

  it("mine: live directory companies we can read, not yours or muted; industries never leave one out (they only rank)", () => {
    expect(
      scopeCompanies(cfg, DIRECTORY, "mine")
        .map((c) => `${c.ats}:${c.slug}`)
        .sort(),
    ).toEqual(["ashby:quiet", "lever:leverco"]);
  });

  it("yours: no directory companies", () => {
    expect(scopeCompanies(cfg, DIRECTORY, "yours")).toEqual([]);
  });

  it("all: every live company we can read", () => {
    expect(
      scopeCompanies(cfg, DIRECTORY, "all")
        .map((c) => `${c.ats}:${c.slug}`)
        .sort(),
    ).toEqual(["ashby:quiet", "lever:leverco"]);
  });

  it("one board per company (the one with most jobs), and none for a company you watch under another board", () => {
    const dir = [entry("lever:binance", { name: "Binance", open_jobs: 40 }), entry("ashby:binance", { name: "Binance", open_jobs: 3 }), entry("ashby:ghco2", { name: "GH Co" })];
    expect(scopeCompanies(cfg, dir, "all").map((c) => `${c.ats}:${c.slug}`)).toEqual(["lever:binance"]);
  });

  it("skips sandbox and training boards, unless you added them yourself", () => {
    const dir = [
      entry("lever:leverdemo", { name: "Lever Implementation Training Environment", tags: ["crypto"] }),
      entry("greenhouse:rhaegal", { name: "Rhaegal - Arago Sandbox", tags: ["crypto"] }),
      entry("ashby:sandboxvr", { name: "Sandbox VR", tags: ["crypto"] }),
      entry("ashby:mysandbox", { name: "Acme Sandbox", origin: "user" }),
    ];
    expect(
      scopeCompanies(cfg, dir, "mine")
        .map((c) => c.slug)
        .sort(),
    ).toEqual(["mysandbox", "sandboxvr"]);
    expect(
      scopeCompanies(cfg, dir, "all")
        .map((c) => c.slug)
        .sort(),
    ).toEqual(["mysandbox", "sandboxvr"]);
    // Your own companies are always scanned: scopeCompanies only adds directory ones.
    const mine = config(`  - { name: "Rhaegal - Arago Sandbox", ats: greenhouse, slug: "rhaegal" }`);
    expect(scopeCompanies(mine, dir, "all").map((c) => c.slug)).not.toContain("rhaegal");
    expect(mine.companies.map((c) => c.slug)).toContain("rhaegal");
  });
});

describe("estimateSeconds", () => {
  const c = (ats: string) => ({ ats: ats as "lever" });
  it("counts the slowest hiring system, since systems are fetched in parallel", () => {
    // Lever queues for its one API host, a request a second; Ashby takes 4 a second.
    expect(estimateSeconds([c("lever"), c("lever"), c("ashby")])).toBe(2);
  });

  it("runs Workday shards as lanes of their own, and boards on their own hosts as many at a time as run.ts does", () => {
    const wd = (shard: string) => ({ ats: "workday" as const, shard });
    const one = estimateSeconds(Array.from({ length: 40 }, () => wd("wd1")));
    expect(estimateSeconds([...Array.from({ length: 20 }, () => wd("wd1")), ...Array.from({ length: 20 }, () => wd("wd5"))])).toBe(Math.ceil(one / 2));
    // 40 boards × 3 requests × 1.2 s, 8 at a time.
    expect(one).toBe(18);
    // BambooHR lanes run 4 at a time: 9 × 1.2 s / 4 = 2.7 s.
    expect(estimateSeconds(Array.from({ length: 9 }, () => c("bamboohr")))).toBe(3);
  });

  it("gives the job feed and the live fetches their own estimate", () => {
    expect(estimateScan([c("lever")], { feed: true, feedSeconds: 12 })).toEqual({ feed: 12, live: 1, seconds: 13 });
    expect(estimateScan([c("lever")])).toEqual({ feed: 0, live: 1, seconds: 1 });
  });

  it("uses speeds measured by earlier scans", () => {
    expect(estimateSeconds([c("lever"), c("lever"), c("ashby")], { lever: 0.2, ashby: 4 })).toBe(4);
  });

  it("learns a lane's speed from durations, counting the companies in flight", () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-"));
    const h = (ms: number) => ({ company: "x", ats: "lever" as const, slug: "x", ok: true, jobsFound: 0, matches: 0, durationMs: ms });
    // 8 companies, 4 at a time, 2 s each: the lane takes 4 s, so 0.5 s per company.
    expect(
      recordSpeeds(
        dir,
        Array.from({ length: 8 }, () => h(2000)),
      ),
    ).toEqual({ lever: 0.5 });
    expect(readSpeeds(dir)).toEqual({ lever: 0.5 });
    rmSync(dir, { recursive: true, force: true });
  });

  it("isn't thrown by a few boards that time out, and forgets speeds measured the old way", () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-"));
    writeFileSync(join(dir, "scan-speed.json"), JSON.stringify({ lever: 40 }));
    expect(readSpeeds(dir)).toEqual({});
    const h = (ms: number) => ({ company: "x", ats: "lever" as const, slug: "x", ok: true, jobsFound: 0, matches: 0, durationMs: ms });
    expect(recordSpeeds(dir, [h(2000), h(2000), h(2000), h(2000), h(51_000)])).toEqual({ lever: 0.5 });
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts the companies a lane really runs at once, and skips systems with too few companies", () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-"));
    const h = (ats: "greenhouse" | "workday" | "smartrecruiters" | "lever", ms: number) => ({ company: "x", ats, slug: "x", ok: true, jobsFound: 0, matches: 0, durationMs: ms });
    const many = (ats: Parameters<typeof h>[0], n: number) => Array.from({ length: n }, () => h(ats, 4000));
    // Greenhouse and Workday run 8 at a time, SmartRecruiters 6; 4 Lever companies are too few to learn from.
    expect(recordSpeeds(dir, [...many("greenhouse", 20), ...many("workday", 20), ...many("smartrecruiters", 12), ...many("lever", 4)])).toEqual({
      greenhouse: 0.5,
      workday: 0.5,
      smartrecruiters: 0.667,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("estimates a learned scan as long as the scan it learned from took", () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-"));
    // A Greenhouse lane of 200 companies, 8 in flight, each waiting 2 s: the lane took 200 × 2 / 8 = 50 s.
    const health = Array.from({ length: 200 }, () => ({ company: "x", ats: "greenhouse" as const, slug: "x", ok: true, jobsFound: 0, matches: 0, durationMs: 2000 }));
    const speeds = recordSpeeds(dir, health);
    expect(estimateSeconds(health, speeds)).toBe(50);
    rmSync(dir, { recursive: true, force: true });
  });

  it("forgets speeds learned before lanes counted their real workers", () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-"));
    writeFileSync(join(dir, "scan-speed.json"), JSON.stringify({ _model: 2, greenhouse: 1 }));
    expect(readSpeeds(dir)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("scan", () => {
  const read = <T>(dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;

  it("mine without a job feed: fetches your companies and every directory company live, keeping only matches from the directory ones", async () => {
    const dir = setup();
    const { http, calls } = fakeHttp(routes);
    const starts: ScanStart[] = [];
    const r = await scan(config(`companies_muted: ["ashby:mutedco"]`), { dataDir: dir, http, now, onStart: (s) => starts.push(s) });

    expect(starts[0]).toMatchObject({ yours: ["GH Co"], extra: 2, total: 3, resumed: 0, scope: "mine", fallback: true, byAts: { greenhouse: 1, lever: 1, ashby: 1 }, resumedByAts: {} });
    expect(calls.some((u) => u.includes("leverco"))).toBe(true);
    expect(calls.some((u) => u.includes("quiet"))).toBe(true);
    const byCompany = (c: string) => r.merged.jobs.filter((j) => j.company === c);
    expect(byCompany("GH Co").length).toBe(3);
    expect(byCompany("leverco").length).toBe(1);
    expect(byCompany("leverco").every((j) => !j.why.gate)).toBe(true);
    // Directory companies with matches are remembered, so their jobs stay between scans.
    expect(readLedger(dir).companies["lever:leverco"]).toMatchObject({ matches: 1 });
    // The Radar shows live jobs only; no index jobs.
    expect(read<{ jobs: unknown[] }>(dir, "discover.json").jobs).toEqual([]);
    expect(existsSync(join(dir, "scan-progress-mine.json"))).toBe(false);
  });

  it("all: fetches every live company in the directory, and records only those that matched", async () => {
    const dir = setup();
    const { http, calls } = fakeHttp(routes);
    const r = await scan(config(), { dataDir: dir, http, now, scope: "all" });
    expect(r.checks.map((c) => c.slug).sort()).toEqual(["leverco", "mutedco", "quiet"]);
    expect(calls.some((u) => u.includes("quiet"))).toBe(true);
    expect(Object.keys(readLedger(dir).companies)).toEqual(["lever:leverco"]);
    // Run history keeps your companies' health and counts every board checked.
    const last = read<{ runs: { health: { slug: string }[]; counts: { checked: number } }[] }>(dir, "meta.json").runs[0]!;
    expect(last.health.map((h) => h.slug)).toEqual(["ghco"]);
    expect(last.counts.checked).toBe(4);
  });

  it("can stop and then resume where it stopped, without fetching done companies again", async () => {
    const dir = setup();
    let fetched = 0;
    const first = await scan(config(), {
      dataDir: dir,
      http: fakeHttp(routes).http,
      now,
      scope: "all",
      onCompanyDone: () => fetched++,
      stopped: () => fetched >= 1,
    });
    expect(first.stopped).toBe(true);
    expect(readProgress(dir, "all")?.health.length).toBeGreaterThanOrEqual(1);
    expect(resumable(dir, "all", now)?.done).toBeGreaterThanOrEqual(1);
    expect(resumable(dir, "mine", now)).toBeUndefined();

    const done = new Set(readProgress(dir, "all")!.health.map((h) => h.slug));
    const { http, calls } = fakeHttp(routes);
    const starts: ScanStart[] = [];
    const second = await scan(config(), { dataDir: dir, http, now, scope: "all", onStart: (s) => starts.push(s) });
    expect(starts[0]!.resumed).toBe(done.size);
    expect(Object.values(starts[0]!.resumedByAts).reduce((a, b) => a + b, 0)).toBe(done.size);
    expect(Object.values(starts[0]!.byAts).reduce((a, b) => a + b, 0)).toBe(starts[0]!.total);
    expect(calls.some((u) => [...done].some((slug) => u.includes(`/${slug}`)))).toBe(false);
    expect(second.result.health.length).toBe(4);
    expect(existsSync(join(dir, "scan-progress-all.json"))).toBe(false);
  });

  it("removes progress files too old to resume, of any scan type", () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-progress-"));
    const head = (scope: string) => `${JSON.stringify({ version: 2, scope, startedAt: new Date().toISOString() })}
`;
    writeFileSync(join(dir, "scan-progress-all.json"), head("all"));
    writeFileSync(join(dir, "scan-progress-mine.json"), head("mine"));
    const dayAgo = (Date.now() - 25 * 3_600_000) / 1000;
    utimesSync(join(dir, "scan-progress-mine.json"), dayAgo, dayAgo);
    expect(resumable(dir, "all")).toBeDefined();
    expect(existsSync(join(dir, "scan-progress-mine.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends progress line by line, and still resumes a progress file from before", async () => {
    const dir = setup();
    let fetched = 0;
    await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "all", onCompanyDone: () => fetched++, stopped: () => fetched >= 1 });
    const lines = readFileSync(join(dir, "scan-progress-all.json"), "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]!)).toMatchObject({ version: 2, scope: "all" });
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const old = readProgress(dir, "all")!;
    writeFileSync(join(dir, "scan-progress-all.json"), JSON.stringify({ ...old, version: 1 }));
    expect(resumable(dir, "all", now)?.done).toBe(old.health.length);
    const starts: ScanStart[] = [];
    await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "all", onStart: (s) => starts.push(s) });
    expect(starts[0]!.resumed).toBe(old.health.length);
  });

  it("records where the time went, per stage and per company, with the request counts", async () => {
    const dir = setup();
    const r = await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "all", syncMs: 1234 });
    expect(r.stats.stages.sync).toBe(1234);
    expect(Object.keys(r.stats.companies ?? {})).toHaveLength(4);
    const saved = read<{ runs: { stages: unknown; http: { requests: number } }[] }>(dir, "scan-stats.json").runs;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.http.requests).toBeGreaterThan(0);
  });

  it("a quick scan in between doesn't lose a stopped long scan", async () => {
    const dir = setup();
    let fetched = 0;
    await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "all", onCompanyDone: () => fetched++, stopped: () => fetched >= 1 });
    const done = resumable(dir, "all", now)!.done;
    await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "mine" });
    expect(resumable(dir, "all", now)?.done).toBe(done);
  });

  it("suggests a same-name directory board for a company whose board is gone, but never switches to it", async () => {
    const dir = setup([...DIRECTORY, entry("lever:leverco2", { name: "Old Co" })]);
    const cfg = config(`  - { name: "Old Co", ats: ashby, slug: "oldco" }`);
    const calls: string[] = [];
    const lever = (url: string) => {
      calls.push(url);
      return url.includes("lever.co/v0/postings/leverco2") ? json(fixture("lever.json")) : routes(url);
    };
    const r = await scan(cfg, { dataDir: dir, http: fakeHttp(lever).http, now, scope: "mine" });
    expect(r.moves.map((m) => [m.name, `${m.from.ats}:${m.from.slug}`, `${m.to.ats}:${m.to.slug}`])).toEqual([["Old Co", "ashby:oldco", "lever:leverco2"]]);
    // Same name proves nothing: the suggested board isn't fetched, and the old one stays yours (and failing) until you choose.
    expect(calls.some((u) => u.includes("leverco2"))).toBe(false);
    expect(r.result.health.find((h) => h.slug === "oldco")).toMatchObject({ ok: false });
    expect(r.result.health.some((h) => h.slug === "leverco2")).toBe(false);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as DataMeta;
    expect(meta.companies.map((c) => `${c.ats}:${c.slug}`)).toContain("ashby:oldco");
    expect(meta.runs[0]!.moves?.map((m) => `${m.from.slug}>${m.to.slug}`)).toEqual(["oldco>leverco2"]);
  });

  it("never suggests a board you replaced with a new link", async () => {
    const dir = setup([...DIRECTORY, entry("lever:leverco2", { name: "Old Co" })]);
    const cfg = { ...config(`  - { name: "Old Co", ats: ashby, slug: "oldco" }`), companies_replaced: ["lever:leverco2"] };
    const r = await scan(cfg, { dataDir: dir, http: fakeHttp(routes).http, now, scope: "mine" });
    expect(r.moves).toEqual([]);
  });

  it("offers a move RawJobs accepted for everyone, marked as checked, even when the old board only times out", async () => {
    const dir = setup([...DIRECTORY, entry("lever:newco", { name: "Something Else" })]);
    const file = join(dir, "catalog", "directory.json");
    const d = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...d, moves: [{ from: "ashby:oldco||", to: "lever:newco||", name: "Old Co", accepted_at: "2026-10-01T00:00:00Z" }] }));
    const cfg = config(`  - { name: "Old Co", ats: ashby, slug: "oldco" }`);
    const timeout = (url: string) => (url.includes("oldco") ? json({ error: "busy" }, 503) : routes(url));
    const r = await scan(cfg, { dataDir: dir, http: fakeHttp(timeout).http, now, scope: "mine" });
    expect(r.moves.map((m) => [`${m.from.slug}>${m.to.slug}`, m.to.name, m.checked_at])).toEqual([["oldco>newco", "Old Co", "2026-10-01T00:00:00Z"]]);
  });

  it("works without companies of your own", async () => {
    const dir = setup();
    const cfg = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai", "abu dhabi"] }
  industries: ["crypto"]
`);
    const r = await scan(cfg, { dataDir: dir, http: fakeHttp(routes).http, now });
    expect(r.checks.map((c) => c.slug).sort()).toEqual(["ghco", "leverco", "mutedco", "quiet"]);
    expect(r.summary?.matches).toBeGreaterThan(0);
  });

  it("yours: only your companies", async () => {
    const dir = setup();
    const { http, calls } = fakeHttp(routes);
    const r = await scan(config(), { dataDir: dir, http, now, scope: "yours" });
    expect(r.checks).toEqual([]);
    expect(calls.some((u) => u.includes("leverco"))).toBe(false);
    expect(r.result.everyCompany).toBeUndefined();
  });

  it("with your industries' boost off, a job's industry doesn't count", async () => {
    const dir = setup();
    // leverco is crypto; this profile wants payments.
    const cfg = (extra: string) =>
      parseConfig(`
profile:
  titles: { include: ["product manager", "head of product"] }
  locations: { include: ["dubai", "abu dhabi"], remote_ok: ["emea"] }
  industries: ["payments"]
${extra}`);
    const on = await scan(cfg(""), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "all", dryRun: true });
    const off = await scan(cfg("scans: { industry_boost: false }"), { dataDir: dir, http: fakeHttp(routes).http, now, scope: "all", dryRun: true });
    const lever = (r: typeof on) => r.result.jobs.find((j) => j.company === "leverco" && !j.why.gate);
    expect(lever(on)?.why.industry).toBe(0);
    expect(lever(off)?.why.industry).toBe(10);
    expect(off.result.jobs.length).toBe(on.result.jobs.length);
  });
});
