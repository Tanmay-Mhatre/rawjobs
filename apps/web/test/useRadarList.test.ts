// @vitest-environment happy-dom
// The Radar's list, worked out from its inputs (components/radar/useRadarList).
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RadarListInput, useRadarList } from "../src/components/radar/useRadarList";
import type { DataMeta, Job, Profile } from "../src/lib/data";
import { DEFAULT_FILTERS, type Filters } from "../src/lib/filters";
import { makeJob } from "./helpers";

const DAY = 86_400_000;
const TITLES = ["Product Manager", "Data Analyst", "Software Engineer", "Designer", "Marketing Lead"];
const profile = {
  name: "Me",
  titles: { include: ["product manager"], exclude: [] },
  seniority_boost: [],
  locations: { include: [], remote_ok: [], remote_exclude: [], workplace: [] },
  industries: [],
  past_employers: [],
  keywords: {},
  min_score: 65,
} as unknown as Profile;
const meta = { version: 1, generatedAt: new Date().toISOString(), profile, companies: [], runs: [] } as unknown as DataMeta;
// Acme posts five roles (three strong: 90, 80, 70); Beta and Gamma one each; Old Co one posted long ago.
const acme = TITLES.map((title, i) => makeJob({ id: `greenhouse:acme:${i}`, title, score: 90 - i * 10, group: `Acme|${title}` }));
const beta = makeJob({ id: "lever:beta:1", ats: "lever", company: "Beta", companyKey: "lever:beta", title: "Analyst", score: 50, group: "Beta|analyst" });
const gamma = makeJob({ id: "lever:gamma:1", ats: "lever", company: "Gamma", companyKey: "lever:gamma", title: "Engineer", score: 40, group: "Gamma|engineer" });
const longAgo = new Date(Date.now() - 1000 * DAY).toISOString();
const old = makeJob({ id: "lever:old:1", ats: "lever", company: "Old Co", companyKey: "lever:old", title: "Clerk", score: 70, postedAt: longAgo, firstSeen: longAgo, group: "Old|clerk" });
const jobs: Job[] = [...acme, beta, gamma, old];

const prefs = { hiddenCompanies: [], hideRules: [] };
const notYours = () => false;
const input = (o: Partial<RadarListInput> = {}): RadarListInput => ({
  jobs,
  meta,
  user: {},
  prefs,
  isYours: notYours,
  profile,
  profileKey: "k",
  base: DEFAULT_FILTERS,
  filters: DEFAULT_FILTERS,
  sort: "best",
  needFacets: false,
  ...o,
});
const run = (o: Partial<RadarListInput> = {}) => renderHook((p: RadarListInput) => useRadarList(p), { initialProps: input(o) });
const withFilters = (f: Partial<Filters>) => ({ filters: { ...DEFAULT_FILTERS, ...f } });

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("useRadarList", () => {
  it("lists one row per role, hiding postings past the age limit and counting them", () => {
    const { result } = run();
    expect(result.current.groups).toHaveLength(7);
    expect(result.current.groups.some((g) => g.lead.id === old.id)).toBe(false);
    expect(result.current.olderCount).toBe(1);
    // No runs yet: the first scan, so nothing is new.
    expect(result.current.firstScan).toBe(true);
    expect(result.current.newCount).toBe(0);
  });

  it("folds one company's extra roles under '+N more', and opening it shows them", () => {
    const { result } = run();
    const more = result.current.rows.find((r) => r.kind === "more");
    expect(more).toMatchObject({ kind: "more", company: "Acme" });
    const before = result.current.navGroups.length;
    act(() => result.current.openCompany(more!.key));
    expect(result.current.rows.some((r) => r.kind === "more")).toBe(false);
    expect(result.current.navGroups.length).toBeGreaterThan(before);
  });

  it("doesn't fold in Newest", () => {
    const { result } = run({ sort: "newest" });
    expect(result.current.rows.every((r) => r.kind === "group")).toBe(true);
    expect(result.current.newest).toBeUndefined();
  });

  it("puts your companies' roles in a strip in Best match, and not again in the list", () => {
    const isYours = (j: Job) => j.company === "Beta" || j.company === "Gamma";
    const { result } = run({ isYours });
    expect(result.current.strip.map((g) => g.lead.id).sort()).toEqual([beta.id, gamma.id]);
    expect(result.current.yourGroups).toBe(2);
    expect(result.current.navGroups.slice(0, 2)).toEqual(result.current.strip);
    const listed = result.current.rows.flatMap((r) => (r.kind === "group" ? [r.group.lead.id] : []));
    expect(listed).not.toContain(beta.id);
    // My companies on: no strip.
    expect(run({ isYours, ...withFilters({ mine: true }) }).result.current.strip).toEqual([]);
  });

  it("works out facet counts only while the filter row or sheet shows them", () => {
    const { result, rerender } = run();
    expect(result.current.counts).toBeUndefined();
    rerender(input({ needFacets: true }));
    expect(result.current.counts?.companies.find((o) => o.value === "Acme")?.count).toBe(5);
  });

  it("counts each quick filter with the others that are on", () => {
    const { result } = run();
    // Strong: score at or over min_score (65); the old posting (70) is past the age limit, so not counted.
    expect(result.current.chipCounts.strong).toBe(3);
    expect(result.current.chipCounts.mine).toBe(0);
  });

  it("names active filters as chips, and offers what to remove when nothing matches", () => {
    const { result } = run(withFilters({ q: "zzz-no-such-job" }));
    expect(result.current.groups).toHaveLength(0);
    expect(result.current.chips.map((c) => c.key)).toEqual(["q"]);
    expect(result.current.relax[0]).toMatchObject({ remove: { q: "" }, count: 7 });
  });
});
