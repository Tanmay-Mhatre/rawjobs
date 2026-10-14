import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchedSince, linuxOnBattery, quickPicks, windowsOnBattery } from "../src/stages";
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

describe("on battery", () => {
  it("Windows: discharging, low or critical is battery; mains states aren't; no battery can't tell", () => {
    expect(windowsOnBattery("1\r\n")).toBe(true);
    expect(windowsOnBattery("4")).toBe(true);
    expect(windowsOnBattery("2")).toBe(false);
    expect(windowsOnBattery("6")).toBe(false);
    expect(windowsOnBattery("")).toBeUndefined();
    expect(windowsOnBattery(undefined)).toBeUndefined();
  });

  it("Linux: a mains supply that's offline, with a battery", () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-power-"));
    const supply = (name: string, files: Record<string, string>) => {
      mkdirSync(join(dir, name));
      for (const [f, v] of Object.entries(files)) writeFileSync(join(dir, name, f), `${v}\n`);
    };
    expect(linuxOnBattery(dir)).toBeUndefined();
    supply("AC", { type: "Mains", online: "0" });
    expect(linuxOnBattery(dir)).toBeUndefined();
    supply("BAT0", { type: "Battery" });
    expect(linuxOnBattery(dir)).toBe(true);
    writeFileSync(join(dir, "AC", "online"), "1\n");
    expect(linuxOnBattery(dir)).toBe(false);
    expect(linuxOnBattery(join(dir, "missing"))).toBeUndefined();
  });
});
