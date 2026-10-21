import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { mergeHistory } from "../src/diff";
import { HttpClient } from "../src/http";
import { earliestPosted, runRadar } from "../src/run";
import { fakeHttp, fixture, json } from "./helpers";

const config = parseConfig(`
profile:
  titles: { include: ["product manager", "head of product"], exclude: ["product marketing"] }
  seniority_boost: ["senior", "head", "group"]
  locations: { include: ["dubai", "abu dhabi"], remote_ok: ["emea"], remote_exclude: ["us"] }
  keywords: { crypto: 5, exchange: 4, payments: 3, tokenization: 5 }
companies:
  - { name: "GH Co", ats: greenhouse, slug: "ghco" }
  - { name: "Lever Co", ats: lever, slug: "leverco" }
  - { name: "Broken Co", ats: ashby, slug: "broken" }
  - { name: "Bank Co", ats: workday, slug: "bank", shard: "wd3", site: "External" }
  - { name: "Off Co", ats: lever, slug: "off", enabled: false }
`);

const now = new Date("2026-10-03T12:00:00Z");

function routes(url: string) {
  if (url.includes("greenhouse")) return json(fixture("greenhouse.json"));
  if (url.includes("lever.co/v0/postings/leverco")) return json(fixture("lever.json"));
  return json({ error: "not found" }, 404);
}

describe("runRadar", () => {
  it("collects scored jobs and per-company health; one failure never stops the run", async () => {
    const { http, calls } = fakeHttp(routes);
    const result = await runRadar(config, { http, now });

    expect(calls.some((u) => u.includes("/off"))).toBe(false); // disabled company skipped
    expect(result.health.map((h) => [h.company, h.ok, h.jobsFound, h.matches])).toEqual([
      ["GH Co", true, 3, 1],
      ["Lever Co", true, 2, 1],
      ["Broken Co", false, 0, 0],
      ["Bank Co", false, 0, 0],
    ]);
    expect(result.health[2]!.error).toMatch(/board not found \(404\): check the slug "broken"/);
    // Workday is fetched like the rest (its API answers 404 here).
    expect(result.health[3]!.error).toMatch(/board not found \(404\)/);
    expect(result.health[3]!.unsupported).toBeUndefined();
    expect(calls).toContain("https://bank.wd3.myworkdayjobs.com/wday/cxs/bank/External/jobs");

    expect(result.jobs).toHaveLength(5);
    const top = result.jobs[0]!;
    expect(top.title).toBe("Head of Product, Exchange");
    expect(top).toMatchObject({ status: "open", firstSeen: now.toISOString(), lastSeen: now.toISOString() });
    expect(top.why).toMatchObject({ title: 30, location: 20, keywords: ["crypto", "tokenization", "exchange"], keywordPoints: 38.3, industry: 10 });
    expect(top.score).toBe(98);
    // Sorted by score, gated jobs last with score 0.
    expect(result.jobs.map((j) => j.score)).toEqual([...result.jobs.map((j) => j.score)].sort((a, b) => b - a));
    expect(result.jobs.at(-1)!.score).toBe(0);
  });

  it("a stop cuts companies in flight short and leaves them unrecorded, so a resume fetches them again", async () => {
    let stop = false;
    const http = new HttpClient({
      hostDelayMs: 0,
      timeoutMs: 60_000,
      stopped: () => stop,
      fetchImpl: (async (input: string, init?: RequestInit) =>
        // Greenhouse never answers; the rest answer at once.
        input.includes("greenhouse") ? new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))) : routes(input)) as typeof fetch,
    });
    const recorded: string[] = [];
    setTimeout(() => (stop = true), 100);
    const started = Date.now();
    const result = await runRadar(config, { http, now, stopped: () => stop, onCompanyResult: (h) => recorded.push(h.company) });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.partial).toBe(true);
    // GH Co was in flight: neither done nor failed.
    expect(result.health.map((h) => h.company)).toEqual(["Lever Co", "Broken Co", "Bank Co"]);
    expect(recorded).not.toContain("GH Co");
    expect(result.jobs.every((j) => !j.id.startsWith("greenhouse"))).toBe(true);
  });

  it("records a board whose site had stopped answering as not reached, not failed", async () => {
    const lever = config.companies[1]!;
    const twoOnLever = {
      ...config,
      companies: [
        { ...lever, name: "Lever A", slug: "a" },
        { ...lever, name: "Lever B", slug: "b" },
      ],
    };
    const http = new HttpClient({ hostDelayMs: 0, retries: 0, breakAfter: 1, sleep: async () => {}, fetchImpl: (async () => new Response("", { status: 503 })) as unknown as typeof fetch });
    const result = await runRadar(twoOnLever, { http, now, maxCompaniesInFlight: 1 });
    expect(result.health.map((h) => [h.company, h.failure, h.notReached])).toEqual([
      ["Lever A", "server", undefined],
      ["Lever B", undefined, true],
    ]);
  });

  it("skips a posting it can't read and keeps the company's other jobs", async () => {
    const gh = fixture("greenhouse.json") as { jobs: unknown[] };
    const { http } = fakeHttp((url) => (url.includes("greenhouse") ? json({ ...gh, jobs: [...gh.jobs, { id: 999, location: { name: "Dubai" } }] }) : routes(url)));
    const result = await runRadar(config, { http, now, only: ["GH Co"] });
    expect(result.health[0]).toMatchObject({ company: "GH Co", ok: true, jobsFound: 3, matches: 1, skipped: 1 });
  });

  it("carries a repost's count over, and keeps the board's date when it's later than ours", async () => {
    const { http } = fakeHttp(routes);
    const first = (await runRadar(config, { http, now, only: ["GH Co"] })).jobs[0]!;
    expect(first.postedAt).toBeDefined();
    expect(first.boardPostedAt).toBeUndefined();
    const prev = { ...first, firstSeen: "2026-06-01T00:00:00.000Z", postedAt: "2026-06-01T00:00:00.000Z", repostedAt: "2026-08-01T00:00:00.000Z", repostCount: 2 };
    const again = (await runRadar(config, { http, now, only: ["GH Co"], previous: [prev] })).jobs.find((j) => j.id === first.id)!;
    expect(again).toMatchObject({ firstSeen: prev.firstSeen, postedAt: prev.postedAt, boardPostedAt: first.postedAt, repostedAt: prev.repostedAt, repostCount: 2 });
  });

  it("can run a single company by name or slug", async () => {
    const { http, calls } = fakeHttp(routes);
    const result = await runRadar(config, { http, now, only: ["LEVERCO"] });
    expect(result.health.map((h) => h.company)).toEqual(["Lever Co"]);
    expect(calls).toHaveLength(1);
  });

  it("runs nothing when there are no companies yet", async () => {
    const { http, calls } = fakeHttp(routes);
    const empty = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
`);
    expect(empty.companies).toEqual([]);
    const result = await runRadar(empty, { http, now });
    expect(result).toMatchObject({ jobs: [], health: [], partial: false });
    expect(calls).toHaveLength(0);
  });
});

describe("directory checks", () => {
  const dir = { name: "Dir Co", enabled: true, ats: "greenhouse" as const, slug: "dirco" };
  const none = { ...config, companies: [] };
  const later = (days: number) => new Date(now.getTime() + days * 86_400_000);

  it("keep only matches, plus jobs already in history: one that stops matching is still listed, not closed", async () => {
    const { http } = fakeHttp(routes);
    // In history: 1001, and 1002 from when it matched (it doesn't now: US remote). 1003 never was.
    const seen = await runRadar({ ...config, companies: [dir] }, { http, now });
    expect(seen.jobs.find((j) => j.id === "greenhouse:dirco:1002")!.why.gate).toBeDefined();
    let history = mergeHistory([], { ...seen, jobs: seen.jobs.filter((j) => j.id !== "greenhouse:dirco:1003") }, [dir]).jobs;

    for (const days of [1, 2, 3]) {
      const run = await runRadar(none, { http, now: later(days), previous: history, checks: [dir] });
      // 1003 is listed too but was never in history: a directory company keeps only its matches.
      expect(run.jobs.map((j) => j.id).sort()).toEqual(["greenhouse:dirco:1001", "greenhouse:dirco:1002"]);
      expect(run.health[0]!.matches).toBe(1);
      history = mergeHistory(history, run, [dir]).jobs;
    }
    expect(history.find((j) => j.id === "greenhouse:dirco:1002")).toMatchObject({ status: "open", lastSeen: later(3).toISOString() });
  });

  it("reopen a stored closed job that is still listed, even when it no longer matches", async () => {
    const { http } = fakeHttp(routes);
    const seen = await runRadar({ ...config, companies: [dir] }, { http, now });
    const previous = seen.jobs.map((j) => (j.id === "greenhouse:dirco:1002" ? { ...j, status: "closed" as const, missedRuns: 2, closedAt: now.toISOString() } : j));
    const run = await runRadar(none, { http, now: later(1), previous, checks: [dir] });
    const merged = mergeHistory(previous, run, [dir]);
    expect(merged.jobs.find((j) => j.id === "greenhouse:dirco:1002")).toMatchObject({ status: "open" });
    expect(merged.newIds.size).toBe(0);
  });
});

describe("earliestPosted", () => {
  const prev = { postedAt: "2026-08-01T00:00:00.000Z", firstSeen: "2026-08-02T00:00:00.000Z" };
  it("keeps the earliest date, so relative dates age and edits don't freshen a job", () => {
    // Workday's "Posted 30+ Days Ago", worked out again two months later.
    expect(earliestPosted("2026-09-03T00:00:00.000Z", prev)).toBe(prev.postedAt);
    expect(earliestPosted("2026-07-01T00:00:00.000Z", prev)).toBe("2026-07-01T00:00:00.000Z");
  });
  it("never puts the posting after we first saw it", () => {
    expect(earliestPosted("2026-09-20T00:00:00.000Z", { firstSeen: "2026-09-01T00:00:00.000Z" })).toBe("2026-09-01T00:00:00.000Z");
  });
  it("leaves new jobs and undated ones alone", () => {
    expect(earliestPosted("2026-09-20T00:00:00.000Z", undefined)).toBe("2026-09-20T00:00:00.000Z");
    expect(earliestPosted(undefined, { firstSeen: "2026-09-01T00:00:00.000Z" })).toBeUndefined();
  });
});
