import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { mergeHistory } from "../src/diff";
import type { RunResult } from "../src/run";
import type { CompanyHealth, Job } from "../src/schema";
import { KEEP_RUNS, readJobs, readMeta, saveRun } from "../src/store";
import { makeJob } from "./helpers";

const T0 = "2026-10-01T03:00:00.000Z";
const T1 = "2026-10-02T03:00:00.000Z";
const T2 = "2026-10-03T03:00:00.000Z";

const job = (id: string, o: Partial<Job> = {}): Job =>
  makeJob({ id: `greenhouse:acme:${id}`, title: `Product Manager ${id}`, url: `https://acme.example/${id}`, description: "payments", firstSeen: T0, lastSeen: T0, ...o });

const health = (ok: boolean): CompanyHealth[] => [{ company: "Acme", ats: "greenhouse", slug: "acme", ok, jobsFound: 0, matches: 0, durationMs: 1 }];
const run = (at: string, jobs: Job[], ok = true): RunResult => ({ startedAt: at, finishedAt: at, jobs, health: health(ok), partial: false, checked: 0 });
const companies = [{ ats: "greenhouse" as const, slug: "acme" }];

describe("mergeHistory: Workday and Taleo", () => {
  const wd = { ats: "workday" as const, slug: "bank", shard: "wd3", site: "External" };
  const wdJob = (req: string, o: Partial<Job> = {}) => job(req, { id: `workday:bank|external:${req}`, ats: "workday", ...o });
  const wdHealth = (ok: boolean): CompanyHealth[] => [{ company: "Bank", ats: "workday", slug: "bank", key: "workday:bank|external", ok, jobsFound: 0, matches: 0, durationMs: 1 }];
  const wdRun = (at: string, jobs: Job[], ok = true): RunResult => ({ startedAt: at, finishedAt: at, jobs, health: wdHealth(ok), partial: false, checked: 0 });

  it("closes a Workday job after it's missing twice, like any other", () => {
    const m1 = mergeHistory([wdJob("R1")], wdRun(T1, []), [wd]);
    expect(m1.jobs.map((j) => [j.id, j.status, j.missedRuns])).toEqual([["workday:bank|external:R1", "open", 1]]);
    const m2 = mergeHistory(m1.jobs, wdRun(T2, []), [wd]);
    expect([...m2.closedIds]).toEqual(["workday:bank|external:R1"]);
  });

  it("keeps a Workday company's jobs when its fetch fails, so they don't come back as new", () => {
    const m1 = mergeHistory([wdJob("R1")], wdRun(T1, [], false), [wd]);
    expect(m1.jobs.map((j) => j.id)).toEqual(["workday:bank|external:R1"]);
    const m2 = mergeHistory(m1.jobs, wdRun(T2, [wdJob("R1", { lastSeen: T2 })]), [wd]);
    expect(m2.newIds.size).toBe(0);
  });

  it("never closes jobs a capped list didn't reach (the fetch was partial)", () => {
    const partialRun = (at: string, jobs: Job[]): RunResult => ({ ...wdRun(at, jobs), health: wdHealth(true).map((h) => ({ ...h, partial: true })) });
    // R1 is past the cap on both runs; R2 is seen each time.
    let m = mergeHistory([wdJob("R1"), wdJob("R2")], partialRun(T1, [wdJob("R2", { lastSeen: T1 })]), [wd]);
    m = mergeHistory(m.jobs, partialRun(T2, [wdJob("R2", { lastSeen: T2 })]), [wd]);
    expect(m.closedIds.size).toBe(0);
    expect(m.jobs.map((j) => [j.id, j.status, j.missedRuns ?? 0]).sort()).toEqual([
      ["workday:bank|external:R1", "open", 0],
      ["workday:bank|external:R2", "open", 0],
    ]);
  });

  it("carries history over from ids saved with the title in them", () => {
    const old = wdJob("R1", { id: "workday:bank|external:Senior-PM_R1", firstSeen: T0 });
    const m = mergeHistory([old], wdRun(T1, [wdJob("R1", { firstSeen: T1, lastSeen: T1 })]), [wd]);
    expect(m.newIds.size).toBe(0);
    expect(m.jobs).toHaveLength(1);
  });

  it("handles Taleo career sections", () => {
    const tl = { ats: "taleo" as const, slug: "corp", site: "ext" };
    const tlJob = job("9", { id: "taleo:corp|ext:9", ats: "taleo" });
    const r: RunResult = {
      startedAt: T1,
      finishedAt: T1,
      jobs: [],
      health: [{ company: "Corp", ats: "taleo", slug: "corp", key: "taleo:corp|ext", ok: true, jobsFound: 0, matches: 0, durationMs: 1 }],
      partial: false,
      checked: 0,
    };
    expect(mergeHistory([tlJob], r, [tl]).jobs[0]?.missedRuns).toBe(1);
  });
});

describe("job ids carry their company's key", () => {
  it("for every connector, jobCompanyKey() of the company is the start of its job ids", async () => {
    const { connectors, jobCompanyKey, companyOfJobId } = await import("../src/connectors");
    const refs = [
      { name: "A", ats: "workday", slug: "Bank", shard: "wd3", site: "External" },
      { name: "A", ats: "taleo", slug: "corp", site: "ext" },
      { name: "A", ats: "taleo", slug: "corp" },
      { name: "A", ats: "greenhouse", slug: "Acme" },
    ] as const;
    const raws: Record<string, unknown> = {
      workday: { title: "PM", externalPath: "/job/Dubai/Senior-PM_R-123", locationsText: "Dubai", postedOn: "Posted Today" },
      taleo: { contestNo: "77", column: ["PM", "Dubai", "Oct 1, 2026"] },
      greenhouse: { id: 5, title: "PM", absolute_url: "https://x", location: { name: "Dubai" }, updated_at: "2026-10-01T00:00:00Z" },
    };
    for (const ref of refs) {
      const c = connectors[ref.ats]!;
      const j = c.normalize(raws[ref.ats] as never, ref as never);
      expect(companyOfJobId(j.id)).toBe(jobCompanyKey(ref));
    }
  });
});

describe("mergeHistory", () => {
  it("marks jobs never seen before as new", () => {
    const m = mergeHistory([job("1")], run(T1, [job("1", { lastSeen: T1 }), job("2", { firstSeen: T1, lastSeen: T1 })]), companies);
    expect([...m.newIds]).toEqual(["greenhouse:acme:2"]);
    expect(m.jobs).toHaveLength(2);
  });

  it("closes a job only after 2 successful runs without it", () => {
    const first = mergeHistory([job("1")], run(T1, []), companies);
    expect(first.jobs[0]).toMatchObject({ status: "open", missedRuns: 1 });
    expect(first.closedIds.size).toBe(0);

    const second = mergeHistory(first.jobs, run(T2, []), companies);
    expect(second.jobs[0]).toMatchObject({ status: "closed", missedRuns: 2, closedAt: T2 });
    expect([...second.closedIds]).toEqual(["greenhouse:acme:1"]);
  });

  it("a job that comes back is open again and not counted as new", () => {
    const closed = job("1", { status: "closed", missedRuns: 2, closedAt: T1 });
    const m = mergeHistory([closed], run(T2, [job("1", { lastSeen: T2 })]), companies);
    expect(m.jobs[0]).toMatchObject({ status: "open", lastSeen: T2 });
    expect(m.newIds.size).toBe(0);
  });

  it("counts a job a half-finished save kept as new: first seen after the last recorded run", () => {
    // A scan at T1 saved history, then failed before recording its run; the next scan resumes it.
    const kept = job("2", { firstSeen: T1, lastSeen: T1 });
    const m = mergeHistory([job("1"), kept], run(T1, [job("1", { lastSeen: T1 }), kept]), companies, undefined, { lastRunAt: T0 });
    expect([...m.newIds]).toEqual(["greenhouse:acme:2"]);
  });

  it("doesn't count a job again once its run is recorded (a stopped scan, resumed)", () => {
    const kept = job("2", { firstSeen: T1, lastSeen: T1 });
    const m = mergeHistory([kept], run(T2, [{ ...kept, lastSeen: T2 }]), companies, undefined, { lastRunAt: T1 });
    expect(m.newIds.size).toBe(0);
  });

  it("never closes jobs when the company's fetch failed", () => {
    const m = mergeHistory([job("1", { missedRuns: 1 })], run(T2, [], false), companies);
    expect(m.jobs[0]).toMatchObject({ status: "open", missedRuns: 1 });
  });

  it("drops jobs of companies removed from the config, and long-closed jobs", () => {
    expect(mergeHistory([job("1")], run(T1, []), []).jobs).toEqual([]);
    const old = job("1", { status: "closed", lastSeen: "2026-06-01T00:00:00.000Z", missedRuns: 5 });
    expect(mergeHistory([old], run(T2, []), companies).jobs).toEqual([]);
  });
});

describe("saveRun / readJobs", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips jobs, keeps run history, and drops descriptions of gated jobs", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-"));
    const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Acme", ats: greenhouse, slug: "acme" }
`);
    const gated = job("2", { score: 0, why: { title: 0, location: 20, keywords: [], keywordPoints: 0, freshness: 10, gate: "title" } });
    const r1 = run(T1, [job("1", { firstSeen: T1 }), gated]);
    const s1 = saveRun(dir, config, r1, mergeHistory([], r1, config.companies));
    expect(s1).toMatchObject({ jobsFound: 2, matches: 1, newMatches: 1, closed: 0 });

    const stored = readJobs(dir);
    expect(stored.find((j) => j.id.endsWith(":1"))!.description).toBe("payments");
    expect(stored.find((j) => j.id.endsWith(":2"))!.description).toBeUndefined();

    const r2 = run(T2, [job("1", { firstSeen: T1, lastSeen: T2 })]);
    saveRun(dir, config, r2, mergeHistory(stored, r2, config.companies));
    const meta = readMeta(dir)!;
    expect(meta.runs.map((r) => r.startedAt)).toEqual([T2, T1]);
    expect(meta.profile.min_score).toBe(70);
    expect(readdirSync(join(dir, "runs"))).toHaveLength(2);
  });

  it("splits dashboard files: matches, the rest, descriptions; and tags companies with industries", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-"));
    mkdirSync(join(dir, "catalog"));
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [{ key: "greenhouse:acme", tags: ["crypto"], visa: { GB: "2026-10-09", XX: "?" } }] }));
    const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Acme", ats: greenhouse, slug: "acme" }
`);
    const gated = job("2", { score: 0, why: { title: 0, location: 20, keywords: [], keywordPoints: 0, freshness: 10, gate: "title" } });
    const r = run(T1, [job("1", { firstSeen: T1, title: "Senior Product Manager", location: "Dubai, UAE" }), gated]);
    saveRun(dir, config, r, mergeHistory([], r, config.companies));
    const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
    const matches = read("jobs.json");
    expect(matches.version).toBe(2);
    expect(matches.jobs.map((j: { id: string }) => j.id)).toEqual(["greenhouse:acme:1"]);
    expect(matches.jobs[0]).toMatchObject({ countries: ["United Arab Emirates"], seniority: "senior", hasDescription: true, group: "acme|senior product manager" });
    expect(matches.jobs[0].description).toBeUndefined();
    // The directory's visa sponsor lists ride along (unknown countries dropped).
    expect(matches.jobs[0].visa).toEqual({ GB: "2026-10-09" });
    expect(read("jobs-other.json").jobs.map((j: { id: string }) => j.id)).toEqual(["greenhouse:acme:2"]);
    expect(read("descriptions.json")).toEqual({ "greenhouse:acme:1": "payments" });
    expect(readMeta(dir)!.companies[0]!.industries).toEqual(["crypto"]);
    // Merge still reads every job, with descriptions.
    expect(
      readJobs(dir)
        .map((j) => j.id)
        .sort(),
    ).toEqual(["greenhouse:acme:1", "greenhouse:acme:2"]);
  });

  it("reads the old single jobs.json until history.json exists", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-"));
    writeFileSync(join(dir, "jobs.json"), JSON.stringify({ version: 1, generatedAt: T0, jobs: [job("9")] }));
    expect(readJobs(dir).map((j) => j.id)).toEqual(["greenhouse:acme:9"]);
  });
});

describe("mergeHistory: reposts", () => {
  it("a job taken down and posted again under a new id keeps its dates and isn't new", () => {
    const old = job("1", { title: "Product Manager", postedAt: "2026-07-01T00:00:00.000Z" });
    const again = job("2", { title: "Product Manager", postedAt: T1, firstSeen: T1, lastSeen: T1 });
    const m = mergeHistory([old], run(T1, [again]), companies);
    expect(m.newIds.size).toBe(0);
    expect(m.jobs).toHaveLength(1);
    expect(m.jobs[0]).toMatchObject({ id: again.id, firstSeen: T0, postedAt: "2026-07-01T00:00:00.000Z", repostedAt: T1, repostCount: 1 });
  });

  it("counts each time it's posted again, and an older save's repost counts as one", () => {
    const T2 = "2026-10-03T03:00:00.000Z";
    const once = job("1", { title: "Product Manager", repostedAt: T0, repostCount: 1 });
    const again = job("2", { title: "Product Manager", firstSeen: T1, lastSeen: T1 });
    const m = mergeHistory([once], run(T1, [again]), companies);
    expect(m.jobs[0]).toMatchObject({ id: again.id, repostedAt: T1, repostCount: 2 });
    const third = job("3", { title: "Product Manager", firstSeen: T2, lastSeen: T2 });
    expect(mergeHistory(m.jobs, run(T2, [third]), companies).jobs[0]).toMatchObject({ id: third.id, repostedAt: T2, repostCount: 3 });
    // Saved before the count existed: repostedAt alone.
    const legacy = job("4", { title: "Product Manager", repostedAt: T0 });
    expect(mergeHistory([legacy], run(T1, [again]), companies).jobs[0]).toMatchObject({ repostCount: 2 });
  });

  it("a new opening in another place, or one still listed, is a new job", () => {
    const old = job("1", { title: "Product Manager" });
    const elsewhere = job("2", { title: "Product Manager", location: "London", firstSeen: T1, lastSeen: T1 });
    expect(mergeHistory([old], run(T1, [elsewhere]), companies).newIds.has(elsewhere.id)).toBe(true);
    const twin = job("3", { title: "Product Manager", firstSeen: T1, lastSeen: T1 });
    const m = mergeHistory([old], run(T1, [{ ...old, lastSeen: T1 }, twin]), companies);
    expect(m.newIds.has(twin.id)).toBe(true);
    expect(m.jobs.find((j) => j.id === twin.id)?.repostedAt).toBeUndefined();
  });

  it("a job gone for over two months comes back as new", () => {
    const old = job("1", { title: "Product Manager", lastSeen: "2026-07-01T00:00:00.000Z", status: "closed" });
    const again = job("2", { title: "Product Manager", firstSeen: T1, lastSeen: T1 });
    expect(mergeHistory([old], run(T1, [again]), companies).newIds.has(again.id)).toBe(true);
  });
});

describe("the run history in meta.json", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the newest KEEP_RUNS runs, and a one-company check adds none", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-"));
    const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Acme", ats: greenhouse, slug: "acme" }
`);
    const at = (i: number) => new Date(Date.parse(T0) + i * 3_600_000).toISOString();
    let stored: Job[] = [];
    for (let i = 0; i < KEEP_RUNS + 2; i++) {
      const r = run(at(i), [job("1", { firstSeen: T0, lastSeen: at(i) })]);
      saveRun(dir, config, r, mergeHistory(stored, r, config.companies));
      stored = readJobs(dir);
    }
    const runs = readMeta(dir)!.runs;
    expect(runs).toHaveLength(KEEP_RUNS);
    expect(runs[0]!.startedAt).toBe(at(KEEP_RUNS + 1));
    expect(runs.at(-1)!.startedAt).toBe(at(2));

    const check = run(at(99), [job("1", { firstSeen: T0, lastSeen: at(99) })]);
    saveRun(dir, config, check, mergeHistory(stored, check, config.companies), { record: false });
    expect(readMeta(dir)!.runs[0]!.startedAt).toBe(at(KEEP_RUNS + 1));
  });
});
