import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
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
    expect(top.why).toEqual({ title: 30, location: 20, keywords: ["crypto", "tokenization", "exchange"], keywordPoints: 40, industry: 10 });
    expect(top.score).toBe(100);
    // Sorted by score, gated jobs last with score 0.
    expect(result.jobs.map((j) => j.score)).toEqual([...result.jobs.map((j) => j.score)].sort((a, b) => b - a));
    expect(result.jobs.at(-1)!.score).toBe(0);
  });

  it("skips a posting it can't read and keeps the company's other jobs", async () => {
    const gh = fixture("greenhouse.json") as { jobs: unknown[] };
    const { http } = fakeHttp((url) => (url.includes("greenhouse") ? json({ ...gh, jobs: [...gh.jobs, { id: 999, location: { name: "Dubai" } }] }) : routes(url)));
    const result = await runRadar(config, { http, now, only: ["GH Co"] });
    expect(result.health[0]).toMatchObject({ company: "GH Co", ok: true, jobsFound: 3, matches: 1, skipped: 1 });
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
