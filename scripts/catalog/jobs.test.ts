import { type FeedRow, HostSkippedError, HttpError } from "@rawjobs/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { atsOfGroup, describeReasons, GROUPS, failReason, feedCoverage, QUIET_AFTER, readOrder, rests, sameJobs, sameSwing, slowHosts } from "./jobs";

describe("failReason", () => {
  it("groups HTTP errors by status", () => {
    expect(failReason(new HttpError("HTTP 429 (https://a.dayforcehcm.com/x)", "https://a.dayforcehcm.com/x", 429))).toBe("HTTP 429");
  });

  it("groups timeouts whatever the wait", () => {
    expect(failReason(new HttpError("timed out after 30.002s (https://x.eightfold.ai/api)", "https://x.eightfold.ai/api"))).toBe("timeout");
  });

  it("drops URLs, names, hosts and numbers so boards with the same problem group together", () => {
    const a = failReason(new Error('Eightfold careers site "kroger.eightfold.ai" not found (no tenant domain on its page)'));
    const b = failReason(new Error('Eightfold careers site "zebra.eightfold.ai" not found (no tenant domain on its page)'));
    expect(a).toBe(b);
    expect(a).toBe('Eightfold careers site "…" not found (no tenant domain on its page)');
    expect(failReason(new HostSkippedError("skipped: x.example.com failed 5 times in a row (https://x.example.com/a)", "https://x.example.com/a"))).toBe("skipped: <host> failed N times in a row");
  });
});

describe("describeReasons", () => {
  it("lists the most common first and counts the rest", () => {
    expect(describeReasons({ timeout: 2, "HTTP 429": 600, "HTTP 404": 1, "HTTP 500": 3 }, 2)).toBe("HTTP 429 ×600, HTTP 500 ×3, 2 more");
    expect(describeReasons(undefined)).toBe("");
  });
});

describe("sameSwing", () => {
  it("ignores a growing directory: only the companies in both runs count", () => {
    // manatal on 14 Oct: 1113 -> 1673 companies, so 109829 -> 159486 jobs in all, but the same companies barely moved.
    expect(sameSwing({ before: 109829, after: 110200 })).toBeUndefined();
  });

  it("flags a big swing at the same companies", () => {
    expect(sameSwing({ before: 1000, after: 500 })).toBe("jobs at the same companies 1000 -> 500");
    expect(sameSwing({ before: 1000, after: 1300 })).toBe("jobs at the same companies 1000 -> 1300");
  });

  it("needs enough jobs to tell, and a count from the crawl", () => {
    expect(sameSwing({ before: 50, after: 0 })).toBeUndefined();
    expect(sameSwing(undefined)).toBeUndefined();
  });
});

describe("sameJobs", () => {
  const board = (n: number, partial?: boolean) => ({
    fetched_at: "2026-10-15T00:00:00Z",
    jobs: Array.from({ length: n }, (_, i) => [String(i), "t", "", "onsite", null] as FeedRow),
    ...(partial ? { partial } : {}),
  });

  it("counts only companies in both runs, and leaves out partial boards", () => {
    const previous = { a: board(100), b: board(300), c: board(50) };
    // b was refused partway this run: 20 of its 300 jobs read. d is new.
    const current = { a: board(110), b: board(20, true), d: board(500) };
    expect(sameJobs(previous, current)).toEqual({ before: 100, after: 110 });
  });
});

describe("feedCoverage", () => {
  const board = (fetched_at: string, n: number) => ({ fetched_at, jobs: Array.from({ length: n }, (_, i) => [String(i), "t", "", "onsite", null] as FeedRow) });
  const run = "2026-10-21T06:13:00Z";

  it("splits companies read this run from those kept from an earlier one", () => {
    const companies = { a: board(run, 3), b: board("2026-10-20T06:13:00Z", 2), c: board(run, 0) };
    expect(feedCoverage(companies, 4, run)).toEqual({ companies: 3, previous: 4, this_run: 2, kept: 1, jobs: 5 });
  });

  it("says there was no previous feed rather than 0", () => {
    expect(feedCoverage({}, undefined, run).previous).toBeNull();
  });
});

describe("slowHosts", () => {
  it("gives every Eightfold board host, companies' own included, the feed's slower gap", () => {
    expect(
      slowHosts([
        { ats: "eightfold", slug: "Bayer.eightfold.ai" },
        { ats: "eightfold", slug: "explore.jobs.netflix.net" },
        { ats: "greenhouse", slug: "acme" },
      ]),
    ).toEqual({ "bayer.eightfold.ai": 1250, "explore.jobs.netflix.net": 1250 });
  });

  it("gives every Avature tenant's host the same gap", () => {
    expect(slowHosts([{ ats: "avature", slug: "Bloomberg" }])).toEqual({ "bloomberg.avature.net": 1250 });
  });
});

describe("readOrder", () => {
  const last: Record<string, string> = { a: "2026-11-04T13:16:00Z", b: "2026-10-29T18:14:00Z", c: "2026-11-04T00:14:00Z" };
  const boards = ["a", "b", "c", "new"];

  it("reads a budgeted system's boards read longest ago first, never-read ones before all", () => {
    expect(readOrder("avature", boards, (e) => last[e])).toEqual(["new", "b", "c", "a"]);
  });

  it("keeps the directory order for other systems", () => {
    expect(readOrder("workday", boards, (e) => last[e])).toEqual(boards);
  });

  it("reads a rested system's boards read longest ago first too", () => {
    expect(readOrder("engage", boards, (e) => last[e])).toEqual(["new", "b", "c", "a"]);
  });
});

describe("rests", () => {
  // Four feed runs a day, 6 hours apart: each 6-hour window is one run's turn.
  const runs = ["2026-11-08T00:13:00Z", "2026-11-08T06:13:00Z", "2026-11-08T12:13:00Z", "2026-11-08T18:13:00Z"].map(Date.parse);
  const boards = Array.from({ length: 2000 }, (_, i) => `engage:board-${i}`);
  const readAt = "2026-11-07T19:00:00Z";

  it("reads each quiet engage board on exactly one run of the four", () => {
    for (const key of boards.slice(0, 50)) {
      const reads = runs.filter((t) => !rests("engage", key, QUIET_AFTER, readAt, t)).length;
      expect(reads).toBe(1);
    }
  });

  it("spreads the boards about evenly over the four runs", () => {
    for (const t of runs) {
      const read = boards.filter((key) => !rests("engage", key, QUIET_AFTER, readAt, t)).length;
      expect(read).toBeGreaterThan(400);
      expect(read).toBeLessThan(600);
    }
  });

  it("reads a board whatever its turn once its rows are 26 hours old", () => {
    const t = Date.parse("2026-11-08T21:00:00Z");
    for (const key of boards.slice(0, 20)) expect(rests("engage", key, QUIET_AFTER + 5, readAt, t)).toBe(false);
  });

  it("reads a board that changed lately, or was never read, every run", () => {
    for (const t of runs) {
      expect(rests("engage", boards[0]!, QUIET_AFTER - 1, readAt, t)).toBe(false);
      expect(rests("engage", boards[0]!, QUIET_AFTER, undefined, t)).toBe(false);
    }
  });

  it("never rests other systems' boards", () => {
    for (const t of runs) expect(rests("workday", "workday:acme", 10, readAt, t)).toBe(false);
  });
});

describe("GROUPS in the workflow", () => {
  // A group missing from one of these lists crawls but isn't saved, or vanishes from the feed when its upload fails.
  const groups = Object.keys(GROUPS).sort();
  const workflow = readFileSync(new URL("../../.github/workflows/jobs-daily.yml", import.meta.url), "utf8");
  const words = (list: string) =>
    list
      .split(/[\s,|]+/)
      .filter(Boolean)
      .sort();

  it("crawls every group (the matrix)", () => {
    expect(words(workflow.match(/group: \[([^\]]+)\]/)![1]!)).toEqual(groups);
  });

  it("stands in for every group in the merge job", () => {
    expect(words(workflow.match(/for g in ([^;]+); do/)![1]!)).toEqual(groups);
  });

  it("saves every group's state (state.sh)", () => {
    const state = readFileSync(new URL("./state.sh", import.meta.url), "utf8");
    const sets = state.match(/^\s*(jobs-sr \|[^)]+)\)/m)![1]!;
    expect(words(sets).map((s) => s.replace(/^jobs-/, ""))).toEqual(groups);
  });
});

describe("atsOfGroup", () => {
  it("gives engage its own group, out of rest", () => {
    expect(atsOfGroup("engage")).toEqual(["engage"]);
    expect(atsOfGroup("rest")).not.toContain("engage");
  });
});
