import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedState } from "@rawjobs/core";
import { describe, expect, it } from "vitest";
import { readFeedV2 } from "./feed-v2";
import { planIndex, toRows, type IndexEntry } from "./index-feed";

const DAY = 86_400_000;
const now = Date.parse("2026-10-26T00:00:00Z");
const ago = (days: number) => new Date(now - days * DAY).toISOString();
const entry = (ats: string, slug: string, extra: Partial<IndexEntry> = {}): IndexEntry => ({ key: `${ats}:${slug}`, ats, slug, name: slug, status: "live", ...extra });
const feedOf = (verified: Record<string, string>): FeedState => ({
  verified,
  jobs: Object.fromEntries(
    Object.keys(verified).map((k) => [
      k,
      [
        ["1", "Engineer", "London", "onsite", "2026-10-20"],
        ["2", "Engineer", "London", "onsite", null],
        ["3", "Designer", "Remote", "remote", "2026-10-25"],
      ],
    ]),
  ),
});
const opts = { now, maxAgeDays: 7 };

describe("planIndex", () => {
  it("takes a company from the feed when the feed read it within 7 days", () => {
    const plan = planIndex([entry("lever", "acme")], feedOf({ "lever:acme": ago(1) }), new Map(), opts);
    expect(plan.live).toEqual([]);
    expect(plan.fromFeed).toEqual([
      {
        key: "lever:acme",
        fetched_at: ago(1),
        open_jobs: 3,
        rows: [
          ["Designer", "Remote", "remote", 1, 1],
          ["Engineer", "London", "onsite", 6, 2],
        ],
      },
    ]);
  });

  it("reads live a company the feed read more than 7 days ago, and counts it as stale", () => {
    const plan = planIndex([entry("lever", "acme")], feedOf({ "lever:acme": ago(7.5) }), new Map(), opts);
    expect(plan.fromFeed).toEqual([]);
    expect(plan.live.map((e) => e.key)).toEqual(["lever:acme"]);
    expect(plan.stale).toBe(1);
  });

  it("keeps the 7-day edge inclusive", () => {
    expect(planIndex([entry("lever", "acme")], feedOf({ "lever:acme": ago(7) }), new Map(), opts).fromFeed).toHaveLength(1);
  });

  it("reads live a company missing from the feed, or two boards that share a feed key", () => {
    const todo = [entry("ashby", "missing"), entry("lever", "twin"), entry("lever", "twin", { key: "lever:twin:eu", region: "eu" })];
    const plan = planIndex(todo, feedOf({ "lever:twin": ago(0) }), new Map(), opts);
    expect(plan.fromFeed).toEqual([]);
    expect(plan.live.map((e) => e.key)).toEqual(["ashby:missing", "lever:twin", "lever:twin:eu"]);
  });

  it("skips a company the index read more recently than the feed, and still re-reads old index rows", () => {
    const indexed = new Map([
      ["lever:newer", ago(0.5)],
      ["lever:old", ago(20)],
    ]);
    const plan = planIndex([entry("lever", "newer"), entry("lever", "old")], feedOf({ "lever:newer": ago(1) }), indexed, opts);
    expect(plan.fromFeed).toEqual([]);
    expect(plan.fresh).toBe(1);
    expect(plan.live.map((e) => e.key)).toEqual(["lever:old"]);
  });

  it("without a feed reads live everything not indexed within 7 days, as before", () => {
    const indexed = new Map([["lever:recent", ago(2)]]);
    const plan = planIndex([entry("lever", "recent"), entry("greenhouse", "acme")], undefined, indexed, opts);
    expect(plan).toEqual({ fromFeed: [], live: [entry("greenhouse", "acme")], stale: 0, fresh: 1 });
  });
});

describe("the feed fallback", () => {
  it("gives no feed when feed.sh fell back to the first format (no second-format files)", () => {
    const dir = mkdtempSync(join(tmpdir(), "index-feed-"));
    writeFileSync(join(dir, "jobs-manifest.json"), "{}");
    expect(readFeedV2(dir)).toBeUndefined();
  });

  it("gives no feed when the snapshot is missing or unreadable", () => {
    const dir = mkdtempSync(join(tmpdir(), "index-feed-"));
    writeFileSync(join(dir, "jobs-v2-manifest.json"), JSON.stringify({ schema: 2, snapshot: { file: "jobs-v2-snapshot-1.json.br" } }));
    expect(readFeedV2(dir)).toBeUndefined();
    writeFileSync(join(dir, "jobs-v2-snapshot-1.json.br"), "not brotli");
    expect(readFeedV2(dir)).toBeUndefined();
  });
});

describe("toRows", () => {
  it("merges a title and location, keeps the newest age and sorts newest first", () => {
    const rows = toRows(
      [
        { title: "A", location: "X", workplace: "onsite", postedAt: ago(3) },
        { title: "A", location: "X", workplace: "onsite", postedAt: ago(1) },
        { title: "B", location: "Y", workplace: "remote" },
      ],
      now,
    );
    expect(rows).toEqual([
      ["A", "X", "onsite", 1, 2],
      ["B", "Y", "remote", null, 1],
    ]);
  });
});
