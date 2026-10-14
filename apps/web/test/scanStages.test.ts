// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { aboutRange, applyScanEvent, backgroundLine, lastScope, sourceRows, type ScanState } from "../src/lib/scan";
import type { RunEvent } from "../src/lib/setup";

const IDLE: ScanState = { phase: "running", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: [] };
const play = (events: RunEvent[], from: ScanState = IDLE) => events.reduce(applyScanEvent, from);
const health = (company: string, matches = 0) => ({ company, ats: "lever" as const, slug: company.toLowerCase(), ok: true, jobsFound: 3, matches, durationMs: 5 });

afterEach(() => localStorage.clear());

describe("Scan now's stages", () => {
  it("splits Scan now's progress by where its companies come from", () => {
    const s = play([
      { type: "start", companies: ["Acme"], total: 4, stage: "quick", bySource: { yours: 1, past: 2, feed: 1 }, doneBySource: { yours: 0, past: 0, feed: 0 } },
      { type: "company", done: 1, doneBySource: { yours: 1, past: 0, feed: 0 }, ...health("Acme") },
      { type: "progress", done: 2, doneBySource: { yours: 1, past: 1, feed: 0 } },
    ]);
    expect(sourceRows(s)).toEqual([
      { label: "Shared feed", done: 1, total: 1, feed: true },
      { label: "Your companies", done: 1, total: 1 },
      { label: "Past matches", done: 1, total: 2 },
      { label: "Feed picks", done: 0, total: 1 },
    ]);
  });

  it("no source rows for a scan that checks every company (stale feed) or an older CLI", () => {
    expect(sourceRows(play([{ type: "start", companies: [], total: 9, fallback: true, bySource: { yours: 0, past: 0, feed: 0 } }]))).toBeNull();
    expect(sourceRows(play([{ type: "start", companies: [], total: 9 }]))).toBeNull();
  });

  it("after Scan now, the background check has its own progress and summary; the quick one's stays", () => {
    const s = play([
      { type: "start", companies: ["Acme"], total: 1 },
      { type: "done", stage: "quick", jobsFound: 3, matches: 2, strong: 1, newMatches: 2, failed: 0 },
      { type: "background" },
      { type: "start", companies: [], total: 100, resumed: 10, stage: "background", seconds: 600 },
      { type: "company", done: 30, ...health("Beta", 2) },
      { type: "progress", done: 50 },
    ]);
    expect(s.phase).toBe("background");
    expect(s.summary?.newMatches).toBe(2);
    expect(s.bg).toMatchObject({ total: 100, done: 50, resumed: 10, found: 2 });
    expect(s.results.Beta).toBeUndefined();
    const done = play([{ type: "done", stage: "background", jobsFound: 9, matches: 3, strong: 0, newMatches: 3, failed: 0, everyCompany: true }], s);
    expect(done.bg?.summary).toMatchObject({ newMatches: 3, everyCompany: true });
    expect(backgroundLine(done.bg!)).toBe("50 done · about 6 min left");
  });

  it("an old saved choice (All companies, or asking every time) becomes the scan; Only my companies stays", () => {
    expect(lastScope()).toBe("mine");
    localStorage.setItem("rawjobs.scanScope", JSON.stringify("all"));
    expect(lastScope()).toBe("mine");
    localStorage.setItem("rawjobs.scanScope", JSON.stringify("yours"));
    expect(lastScope()).toBe("yours");
  });

  it("gives long estimates as an honest range", () => {
    expect(aboutRange(150)).toBe("about 3 min");
    expect(aboutRange(3900)).toBe("about 60 to 70 min");
  });
});
