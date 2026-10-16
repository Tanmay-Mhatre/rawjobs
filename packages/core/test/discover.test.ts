import { describe, expect, it } from "vitest";
import { findCandidates, pickChecks, recordChecks, toIndexJobs, type IndexFile } from "../src/discover";
import type { IndexedCompany, IndexRow } from "../src/suggest";
import { profile } from "./helpers";

const now = new Date("2026-10-03T12:00:00Z");
const DAY = 86_400_000;

const co = (key: string, rows: IndexRow[]): IndexedCompany => {
  const [ats, slug] = key.split(":") as [string, string];
  return { key, name: slug, ats, slug, careers_url: `https://careers.example/${slug}`, open_jobs: rows.length, rows };
};
const pm = (location: string, age = 2): IndexRow => ["Senior Product Manager", location, "onsite", age, 1];
const index = (companies: IndexedCompany[], generated = now): IndexFile => ({ generated_at: generated.toISOString(), companies });

describe("findCandidates", () => {
  it("keeps rows that pass your gates, best estimate first, ages counted from the index build", () => {
    const built = new Date(now.getTime() - 5 * DAY);
    const c = findCandidates(profile(), index([co("lever:a", [pm("Dubai", 30), ["Software Engineer", "Dubai", "onsite", 1, 1]]), co("ashby:b", [pm("Dubai", 1), pm("Berlin")])], built), now);
    expect(c.map((x) => [x.company.key, x.location])).toEqual([
      ["ashby:b", "Dubai"],
      ["lever:a", "Dubai"],
    ]);
    // Posted a day before an index built 5 days ago: 6 days old now.
    expect(c[0]!.postedAt).toBe(new Date(built.getTime() - DAY).toISOString());
    // Equal fit (the estimate has no age in it): the fresher one ranks first.
    expect(c[0]!.estimate).toBe(c[1]!.estimate);
    // No description: topics are unknown, so they count part of the bar.
    expect(c[0]!.why.keywordPoints).toBe(15);
  });

  it("counts a company's ages from when it was fetched, which can be before the index was built", () => {
    const fetched = new Date(now.getTime() - 3 * DAY);
    const company = { ...co("lever:a", [pm("Dubai", 4)]), fetched_at: fetched.toISOString() };
    const [c] = findCandidates(profile(), index([company], now), now);
    // 4 days old when fetched 3 days ago: posted 7 days ago.
    expect(c!.postedAt).toBe(new Date(now.getTime() - 7 * DAY).toISOString());
  });
});

describe("pickChecks", () => {
  const candidates = findCandidates(
    profile(),
    index([
      co("lever:best", [pm("Dubai", 0), pm("Abu Dhabi", 0)]),
      co("greenhouse:yours", [pm("Dubai", 0)]),
      co("ashby:muted", [pm("Dubai", 0)]),
      co("ashby:recent", [pm("Dubai", 1)]),
      co("kenexa:x", [pm("Dubai", 1)]), // a hiring system we can't read
      co("greenhouse:old", [pm("Dubai", 20)]),
      co("ashby:older", [pm("Dubai", 25)]),
    ]),
    now,
  );
  const ledger = {
    version: 1 as const,
    companies: {
      "ashby:recent": { name: "recent", ats: "ashby" as const, slug: "recent", lastChecked: new Date(now.getTime() - 3 * DAY).toISOString(), matches: 1 },
      "greenhouse:old": { name: "old", ats: "greenhouse" as const, slug: "old", lastChecked: new Date(now.getTime() - 8 * DAY).toISOString(), matches: 1 },
    },
  };

  it("picks companies that aren't yours, muted, unreadable or checked this week, one per company, best first", () => {
    const picked = pickChecks(candidates, { tracked: new Set(["greenhouse:yours"]), muted: new Set(["ashby:muted"]), ledger, limit: 10, now });
    expect(picked.map((c) => `${c.ats}:${c.slug}`)).toEqual(["lever:best", "greenhouse:old", "ashby:older"]);
    expect(picked[0]).toMatchObject({ name: "best", careers_url: "https://careers.example/best", enabled: true });
  });

  it("stops at the limit, and picks nothing when checks are off", () => {
    expect(pickChecks(candidates, { tracked: new Set(), muted: new Set(), ledger, limit: 2, now })).toHaveLength(2);
    expect(pickChecks(candidates, { tracked: new Set(), muted: new Set(), ledger, limit: 0, now })).toEqual([]);
  });
});

describe("recordChecks", () => {
  it("records each check, failures too, and forgets checks older than 30 days", () => {
    const old = { name: "gone", ats: "lever" as const, slug: "gone", lastChecked: new Date(now.getTime() - 31 * DAY).toISOString(), matches: 2 };
    const ledger = recordChecks(
      { version: 1, companies: { "lever:gone": old } },
      [
        { name: "A", ats: "lever", slug: "a", enabled: true },
        { name: "B", ats: "ashby", slug: "b", enabled: true },
      ],
      [
        { ats: "lever", slug: "a", ok: true, matches: 3 },
        { ats: "ashby", slug: "b", ok: false, matches: 0, error: "board not found" },
      ],
      now,
    );
    expect(Object.keys(ledger.companies).sort()).toEqual(["ashby:b", "lever:a"]);
    expect(ledger.companies["lever:a"]).toMatchObject({ matches: 3, lastChecked: now.toISOString() });
    expect(ledger.companies["ashby:b"]!.error).toBe("board not found");
  });
});

describe("toIndexJobs", () => {
  const candidates = findCandidates(profile(), index([co("lever:live", [pm("Dubai")]), co("ashby:muted", [pm("Dubai")]), co("ashby:other", [pm("Dubai"), pm("Abu Dhabi")])]), now);

  it("lists jobs at companies that aren't live or muted, marked estimated, linking to the careers page", () => {
    const jobs = toIndexJobs(candidates, { live: new Set(["lever:live"]), muted: new Set(["ashby:muted"]), indexGeneratedAt: now.toISOString() });
    expect(jobs.map((j) => j.location)).toEqual(["Dubai", "Abu Dhabi"]);
    expect(jobs[0]).toMatchObject({ estimated: true, companyKey: "ashby:other", company: "other", url: "https://careers.example/other", status: "open", hasDescription: false });
    expect(jobs[0]!.id).toMatch(/^index:ashby:other:/);
    // Same row, same id: the Radar keeps statuses and "seen" across scans.
    expect(toIndexJobs(candidates, { live: new Set(), muted: new Set(), indexGeneratedAt: now.toISOString() }).map((j) => j.id)).toContain(jobs[0]!.id);
    expect(toIndexJobs(candidates, { live: new Set(), muted: new Set(), indexGeneratedAt: now.toISOString(), limit: 1 })).toHaveLength(1);
  });

  it("carries the company's visa sponsor lists", () => {
    const sponsor = { ...co("lever:sponsor", [pm("Dubai")]), visa: { GB: "2026-10-09" } };
    const jobs = toIndexJobs(findCandidates(profile(), index([sponsor, co("lever:plain", [pm("Dubai")])]), now), { live: new Set(), muted: new Set(), indexGeneratedAt: now.toISOString() });
    expect(Object.fromEntries(jobs.map((j) => [j.companyKey, j.visa]))).toEqual({ "lever:sponsor": { GB: "2026-10-09" }, "lever:plain": undefined });
  });
});
