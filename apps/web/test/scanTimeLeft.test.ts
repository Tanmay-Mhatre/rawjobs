import { afterEach, describe, expect, it, vi } from "vitest";
import { aboutRange, aboutTime, applyScanEvent, backgroundLeft, measuredRate, newPace, timeLeft, track, type Background, type Pace, type ScanState } from "../src/lib/scan";
import type { RunEvent } from "../src/lib/setup";

const T0 = 1_760_000_000_000;
afterEach(() => vi.useRealTimers());

/** A pace with `done` sampled every 10 s from 3 s after T0, `rate` companies a second. */
function paced(rate: number, seconds: number, from = 0): { pace: Pace; done: number; at: number } {
  let pace: Pace | undefined = newPace(T0);
  let done = from;
  for (let t = 3; t <= 3 + seconds; t += 1) {
    done = from + Math.round(rate * (t - 3));
    pace = track(pace, done, T0 + t * 1000);
  }
  return { pace: pace!, done, at: T0 + (3 + seconds) * 1000 };
}

describe("time left", () => {
  it("shows long times as a range, in hours or days, never one-decimal hundreds of hours", () => {
    expect(aboutRange(150)).toBe("about 3 min");
    expect(aboutRange(3900)).toBe("about 60 to 70 min");
    expect(aboutRange(9.5 * 3600)).toBe("about 9 to 10 h");
    expect(aboutRange(235.1 * 3600)).toBe("about 9 to 10 days");
    expect(aboutTime(2 * 3600)).toBe("about 2.0 h");
    expect(aboutTime(14.4 * 3600)).toBe("about 14 h");
    expect(aboutTime(235.1 * 3600)).toBe("about 10 days");
  });

  it("ignores the replayed burst a page gets when it picks up a running scan", () => {
    let pace = track(newPace(T0), 50_000, T0 + 500);
    expect(pace?.samples).toEqual([]);
    pace = track(pace, 50_010, T0 + 3_000);
    expect(pace?.samples).toEqual([{ at: T0 + 3_000, done: 50_010 }]);
  });

  it("trusts the measured pace only after 30 s and 10 companies", () => {
    expect(measuredRate(paced(1, 20).pace, 20, T0 + 23_000)).toBeNull();
    expect(measuredRate(paced(0.1, 60).pace, 6, T0 + 63_000)).toBeNull();
    const p = paced(2, 60);
    expect(measuredRate(p.pace, p.done, p.at)).toBeCloseTo(2, 1);
  });

  it("measures over the last 10 minutes, so a slow start doesn't drag on", () => {
    let pace: Pace | undefined = newPace(T0);
    let done = 0;
    for (let t = 3; t <= 1800; t++) {
      done += t < 300 ? (t % 10 === 0 ? 1 : 0) : 5;
      pace = track(pace, done, T0 + t * 1000);
    }
    expect(measuredRate(pace, done, T0 + 1_800_000)).toBeCloseTo(5, 0);
  });

  it("hides an untrusted long estimate, then follows the real pace", () => {
    // 139,000 companies; the start's estimate says 235 h; this run really does about 4 a second.
    const total = 139_000;
    expect(timeLeft({ seconds: 235.1 * 3600, total, done: 0, resumed: 0, pace: newPace(T0), lastAt: T0 + 1000 })).toBe(0);
    const p = paced(4, 120);
    const left = timeLeft({ seconds: 235.1 * 3600, total, done: p.done, resumed: 0, pace: p.pace, lastAt: p.at });
    expect(left / 3600).toBeCloseTo((total - p.done) / 4 / 3600, 0);
  });

  it("a resumed check counts only what's left, at this run's pace", () => {
    const p = paced(4, 120, 70_000);
    const left = timeLeft({ seconds: 66.4 * 3600, total: 139_000, done: p.done, resumed: 70_000, pace: p.pace, lastAt: p.at });
    expect(left / 3600).toBeCloseTo((139_000 - p.done) / 4 / 3600, 0);
  });

  it("keeps a short estimate until measured, then blends the real pace in over two minutes", () => {
    expect(timeLeft({ seconds: 600, total: 300, done: 0, resumed: 0, pace: newPace(T0), lastAt: T0 })).toBe(600);
    // Really twice as fast as estimated (1 a second, so 300 s for 300 companies).
    const half = paced(1, 60);
    const blended = timeLeft({ seconds: 600, total: 300, done: half.done, resumed: 0, pace: half.pace, lastAt: half.at });
    const full = paced(1, 150);
    const real = timeLeft({ seconds: 600, total: 300, done: full.done, resumed: 0, pace: full.pace, lastAt: full.at });
    expect(blended).toBeGreaterThan(300 - half.done);
    expect(blended).toBeLessThan(600 * (1 - half.done / 300));
    expect(real).toBeCloseTo(300 - full.done, 0);
  });

  it("the background check's line follows events as they arrive", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let s: ScanState = { phase: "background", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: [], bg: { total: 0, done: 0, resumed: 0, found: 0, failed: 0 } };
    s = applyScanEvent(s, { type: "start", stage: "background", companies: [], total: 139_000, seconds: 235.1 * 3600 } as RunEvent);
    expect(backgroundLeft(s.bg as Background)).toBe("");
    for (let t = 1; t <= 300; t++) {
      vi.setSystemTime(T0 + t * 1000);
      s = applyScanEvent(s, { type: "progress", done: t * 4 } as RunEvent);
    }
    // (139,000 - 1,200) / 4 a second ≈ 9.6 h.
    expect(backgroundLeft(s.bg as Background)).toBe("about 9 to 10 h left");
  });
});
