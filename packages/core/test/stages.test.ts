import { describe, expect, it } from "vitest";
import { fetchedSince, quickPicks } from "../src/stages";
import type { CompanyRef } from "../src/schema";

const ref = (slug: string): CompanyRef => ({ name: slug, ats: "lever", slug, enabled: true });

describe("quickPicks", () => {
  const ledger = { version: 1 as const, companies: { "lever:past": { name: "past", ats: "lever" as const, slug: "past", lastChecked: "2026-10-01T00:00:00Z", matches: 1 } } };

  it("past matches first, then the feed's picks; nothing else", () => {
    const feed = { covered: new Set(["lever:a", "lever:b", "lever:past"]), matching: new Set(["lever:b"]) };
    const r = quickPicks([ref("a"), ref("b"), ref("past"), ref("c")], { feed, ledger });
    expect(r.picks.map((c) => c.slug)).toEqual(["past", "b"]);
    expect(Object.fromEntries(r.sources)).toEqual({ "lever:past": "past", "lever:b": "feed" });
    expect(r.fallback).toBe(false);
  });

  it("every company when there's no feed fresh enough to pick from", () => {
    const r = quickPicks([ref("a"), ref("b")], { feed: { covered: new Set(), matching: new Set() }, ledger });
    expect(r).toMatchObject({ fallback: true });
    expect(r.picks).toHaveLength(2);
    expect(quickPicks([ref("a")], { ledger }).fallback).toBe(true);
  });
});

describe("fetchedSince", () => {
  it("counts a fetch that worked or failed at or after the time", () => {
    expect(fetchedSince({ okAt: 100 }, 100)).toBe(true);
    expect(fetchedSince({ failedAt: 150 }, 100)).toBe(true);
    expect(fetchedSince({ okAt: 99 }, 100)).toBe(false);
    expect(fetchedSince(undefined, 100)).toBe(false);
  });
});
