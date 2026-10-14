import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { activityMonths, hasHiringData, hiringSummary, localActivity, surgeTitle, viewSummary, type ActivityFile, type ActivityView, type LocalJob } from "../src/activity";
import { parseConfig } from "../src/config";
import { mergeHistory } from "../src/diff";
import { readFeedActivity } from "../src/job-feed";
import type { RunResult } from "../src/run";
import type { Job } from "../src/schema";
import { readMeta, saveRun } from "../src/store";
import { makeJob } from "./helpers";

const at = (day: string) => `${day}T03:00:00.000Z`;
const local = (title: string, firstSeen: string, o: Partial<LocalJob> = {}): LocalJob => ({ title, firstSeen: at(firstSeen), lastSeen: at("2026-10-13"), status: "open", ...o });

describe("your own companies' activity, from your scans", () => {
  it("starts on the first scan: what it found then isn't new", () => {
    const a = localActivity([local("Engineer", "2026-09-01"), local("Designer", "2026-09-01"), local("Writer", "2026-10-05"), local("Data Intern", "2026-10-06")], "2026-10-13")!;
    expect(a.s).toBe("2026-09-01");
    expect(a.n).toBe(2);
    expect(a.m!.slice(-2)).toEqual([0, 2]);
    expect(a.i!.at(-1)).toBe(1);
    expect(a.g).toBeUndefined();
  });

  it("leaves out a new id for a title listed in the last 60 days, but not one older", () => {
    const a = localActivity(
      [
        local("Engineer", "2026-06-01"),
        local("Designer", "2026-06-01", { status: "closed", lastSeen: at("2026-06-10") }),
        // The same role again: closed under 60 days ago -> a repost; listed in two cities -> one role.
        local("Product Manager", "2026-06-02", { status: "closed", lastSeen: at("2026-09-20") }),
        local("Product Manager - London", "2026-10-01"),
        local("Writer", "2026-10-02"),
        local("Writer - Remote", "2026-10-02"),
        // Last listed in June: new again.
        local("Designer", "2026-10-03"),
      ],
      "2026-10-13",
    )!;
    expect(a.n).toBe(2);
    expect(a.m!.slice(-5)).toEqual([1, 0, 0, 0, 2]);
  });

  it("counts roles posted in the last 30 days only when jobs have posted dates", () => {
    expect(localActivity([local("Engineer", "2026-10-01")], "2026-10-13")!.p).toBeUndefined();
    const a = localActivity([local("Engineer", "2026-10-01", { postedAt: at("2026-10-01") }), local("Designer", "2026-10-01", { postedAt: at("2026-08-01") })], "2026-10-13")!;
    expect(a.p).toBe(1);
    expect(localActivity([], "2026-10-13")).toBeUndefined();
  });
});

describe("the dashboard's view", () => {
  const feedCtx = { date: "2026-10-13", since: "2026-07-01", first_month: activityMonths("2026-10-13")[0]! };
  const view: ActivityView = {
    version: 1,
    ready: true,
    feed: feedCtx,
    local: { date: "2026-10-13", since: null, first_month: feedCtx.first_month },
    companies: {
      "greenhouse:acme": { src: "feed", m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 2, 14], n: 14, p: 20 },
      "lever:mine": { src: "local", n: 1, s: "2026-10-01", m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] },
      "lever:quiet": { src: "local", n: 0, s: "2026-10-13" },
    },
  };

  it("reads each company with its own source's dates", () => {
    expect(viewSummary(view, "greenhouse:acme")).toMatchObject({ source: "feed", basis: "new", last30: 14, baselineReady: true, surge: true });
    expect(viewSummary(view, "lever:mine")).toMatchObject({ source: "local", basis: "posted", since: "2026-10-01", baselineReady: false, surge: false });
  });

  it("has nothing for a company without records, or without anything to say", () => {
    expect(viewSummary(view, "lever:unknown")).toBeUndefined();
    expect(viewSummary(view, undefined)).toBeUndefined();
    expect(viewSummary(null, "greenhouse:acme")).toBeUndefined();
    expect(viewSummary(view, "lever:quiet")).toBeUndefined();
    expect(hasHiringData(hiringSummary({ n: 0, p: 0 }, feedCtx))).toBe(true);
  });

  it("says the numbers in the surge tag's hover", () => {
    expect(surgeTitle("Northwind Pay", { n: 14, usual: 4.6 })).toBe("Northwind Pay opened 14 roles in the last 30 days; usually about 5.");
    expect(surgeTitle("Acme", { n: 5, usual: 0.2 })).toBe("Acme opened 5 roles in the last 30 days; usually none.");
  });
});

describe("saveRun writes activity.json and tags surges", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Acme", ats: greenhouse, slug: "acme" }
  - { name: "Beta", ats: lever, slug: "beta" }
`);
  const T = at("2026-10-13");
  const job = (id: string, o: Partial<Job> = {}): Job => makeJob({ id, lastSeen: T, ...o });
  /** Acme and Beta, both first scanned on `first`; Beta has opened one role since. */
  const scan = (first: string): RunResult => ({
    startedAt: T,
    finishedAt: T,
    jobs: [
      job("greenhouse:acme:1", { firstSeen: at(first) }),
      job("lever:beta:1", { company: "Beta", ats: "lever", firstSeen: at(first) }),
      job("lever:beta:2", { company: "Beta", ats: "lever", title: "Designer", firstSeen: at("2026-10-10") }),
    ],
    health: [
      { company: "Acme", ats: "greenhouse", slug: "acme", ok: true, jobsFound: 1, matches: 1, durationMs: 1 },
      { company: "Beta", ats: "lever", slug: "beta", ok: true, jobsFound: 2, matches: 1, durationMs: 1 },
    ],
    partial: false,
    checked: 0,
  });
  const feedFile = (date: string): ActivityFile => ({
    schema: 1,
    generated_at: at(date),
    date,
    since: "2026-07-01",
    first_month: activityMonths(date)[0]!,
    companies: { "greenhouse:acme": { m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 2, 14], n: 14, p: 20 } },
  });
  const withFeed = (file: ActivityFile) => {
    mkdirSync(join(dir, "catalog", "jobs"), { recursive: true });
    writeFileSync(join(dir, "catalog", "jobs", "activity.json.br"), brotliCompressSync(JSON.stringify(file)));
  };
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

  it("takes the feed's numbers where it covers the company, your scans' elsewhere", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-"));
    withFeed(feedFile("2026-10-13"));
    const run = scan("2026-09-01");
    saveRun(dir, config, run, mergeHistory([], run, config.companies));
    const view = read("activity.json") as ActivityView;
    expect(view.ready).toBe(true);
    expect(view.companies["greenhouse:acme"]).toMatchObject({ src: "feed", n: 14 });
    expect(view.companies["lever:beta"]).toMatchObject({ src: "local", n: 1, s: "2026-09-01" });
    const all = [...read("jobs.json").jobs, ...read("jobs-other.json").jobs];
    const acme = all.find((j: Job) => j.id === "greenhouse:acme:1");
    expect(acme.surge.n).toBe(14);
    expect(acme.surge.usual).toBeGreaterThan(0);
    expect(all.find((j: Job) => j.id === "lever:beta:1").surge).toBeUndefined();
    expect(readMeta(dir)!.hiringReady).toBe(true);
  });

  it("without the feed's file (or with an old one) everything comes from your scans, and nothing is ready yet", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-"));
    withFeed(feedFile("2026-09-30"));
    expect(readFeedActivity(dir, Date.parse(T))).toBeUndefined();
    expect(readFeedActivity(dir, Date.parse(at("2026-10-05")))).toBeDefined();
    // First scanned 13 days ago: too soon to compare with.
    const run = scan("2026-09-30");
    saveRun(dir, config, run, mergeHistory([], run, config.companies));
    const view = read("activity.json") as ActivityView;
    expect(view.feed).toBeUndefined();
    expect(view.ready).toBe(false);
    expect(view.companies["greenhouse:acme"]).toMatchObject({ src: "local", n: 0 });
    expect(readMeta(dir)!.hiringReady).toBeUndefined();
  });
});
