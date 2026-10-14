import { describe, expect, it } from "vitest";
import type { Job } from "../src/lib/data";
import { groupStale, isStale, staleReasons } from "../src/lib/stale";
import { makeJob } from "./helpers";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const job = (o: Partial<Job> = {}) => makeJob({ firstSeen: daysAgo(1), postedAt: daysAgo(1), lastSeen: daysAgo(0), ...o });
const ctx = { now: NOW };

describe("staleReasons and isStale", () => {
  it("a fresh, complete job has no reasons", () => {
    expect(staleReasons(job({ descriptionLength: 4000 }), ctx)).toEqual([]);
    expect(isStale(job(), ctx)).toBe(false);
  });

  it("a job listed for months whose board says it's new is stale on that alone", () => {
    const j = job({ firstSeen: daysAgo(103), postedAt: daysAgo(103), boardPostedAt: daysAgo(3) });
    const reasons = staleReasons(j, ctx);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^Listed since .+ \(103 days\), though the board says posted 3 days ago$/);
    expect(isStale(j, ctx)).toBe(true);
    // Listed under two months: just a board that dates it later.
    expect(isStale(job({ firstSeen: daysAgo(40), postedAt: daysAgo(40), boardPostedAt: daysAgo(3) }), ctx)).toBe(false);
  });

  it("age: over two months is a weak sign, over four a strong one", () => {
    expect(staleReasons(job({ postedAt: daysAgo(75) }), ctx)).toEqual(["Posted 2 months ago"]);
    expect(isStale(job({ postedAt: daysAgo(75) }), ctx)).toBe(false);
    expect(isStale(job({ postedAt: daysAgo(59) }), ctx)).toBe(false);
    expect(staleReasons(job({ postedAt: undefined, firstSeen: daysAgo(125) }), ctx)).toEqual(["First seen 4 months ago"]);
    expect(isStale(job({ postedAt: daysAgo(125) }), ctx)).toBe(true);
  });

  it("reposts: once is weak, twice or more strong; older saves without a count are one", () => {
    const once = job({ repostedAt: daysAgo(5) });
    expect(staleReasons(once, ctx)[0]).toMatch(/^Taken down and posted again once \(\w+\)$/);
    expect(isStale(once, ctx)).toBe(false);
    const twice = job({ repostedAt: daysAgo(5), repostCount: 2 });
    expect(staleReasons(twice, ctx)[0]).toMatch(/^Taken down and posted again twice \(last in \w+\)$/);
    expect(isStale(twice, ctx)).toBe(true);
    expect(staleReasons(job({ repostedAt: daysAgo(5), repostCount: 4 }), ctx)[0]).toContain("4 times");
  });

  it("a short description is a weak sign, and only counts when it's known", () => {
    expect(staleReasons(job({ descriptionLength: 240 }), ctx)).toEqual(["The description is short (240 characters)"]);
    expect(isStale(job({ descriptionLength: 240 }), ctx)).toBe(false);
    expect(staleReasons(job(), { ...ctx, descriptionLength: 120 })).toEqual(["The description is short (120 characters)"]);
    expect(staleReasons(job({ descriptionLength: 0 }), ctx)).toEqual([]);
  });

  it("two weak signs make it stale", () => {
    const j = job({ postedAt: daysAgo(70), repostedAt: daysAgo(10) });
    expect(staleReasons(j, ctx)).toHaveLength(2);
    expect(isStale(j, ctx)).toBe(true);
    expect(isStale(job({ repostedAt: daysAgo(10), descriptionLength: 200 }), ctx)).toBe(true);
  });

  it("a closed job is never tagged", () => {
    expect(staleReasons(job({ status: "closed", postedAt: daysAgo(200), repostedAt: daysAgo(5), repostCount: 3 }), ctx)).toEqual([]);
  });
});

describe("groupStale", () => {
  it("is false when any open posting of the role is fresh", () => {
    const old = job({ postedAt: daysAgo(150) });
    expect(groupStale([old, job()], ctx)).toEqual({ stale: false, reasons: [] });
    // A closed fresh posting doesn't make the role live.
    expect(groupStale([old, job({ status: "closed" })], ctx).stale).toBe(true);
    expect(groupStale([job({ status: "closed" })], ctx).stale).toBe(false);
  });

  it("is true when every open posting is stale, with the least stale posting's reasons", () => {
    const veryOld = job({ postedAt: daysAgo(200), repostedAt: daysAgo(5), repostCount: 3 });
    const old = job({ postedAt: daysAgo(150) });
    const g = groupStale([veryOld, old], ctx);
    expect(g.stale).toBe(true);
    expect(g.reasons).toEqual(["Posted 5 months ago"]);
  });
});
