// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/lib/data";
import { dispatchScanEvent, getScan, IDLE, resetScanStore, updateScan, useLiveJobs, useScanSelector, useScanState } from "../src/lib/scanStore";
import type { RunEvent, ScanScope } from "../src/lib/setup";

/** A new scan, as useScan starts one. */
const running = (scope: ScanScope) => ({ ...IDLE, phase: "running" as const, scope });
import { scanLines } from "../../../packages/server/src/scan-lines";
import { makeJob } from "./helpers";

/** Frames run only when the test says so. */
let frames: FrameRequestCallback[] = [];
const nextFrame = () =>
  act(() => {
    const run = frames;
    frames = [];
    for (const f of run) f(performance.now());
  });

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  resetScanStore();
  updateScan(() => running("all"));
  dispatchScanEvent({ type: "start", stage: "quick", companies: [], total: 6000 } as RunEvent);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetScanStore();
});

const company = (i: number, matches = 1): RunEvent => ({ type: "company", company: `Co${i}`, ats: "greenhouse", slug: `co${i}`, ok: true, jobs: 3, matches, ms: 10, done: i + 1 }) as RunEvent;

describe("scan store", () => {
  it("6,000 company events apply in under 200 ms, and results holds 6,000", () => {
    const t0 = performance.now();
    for (let i = 0; i < 6000; i++) dispatchScanEvent(company(i));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    expect(Object.keys(getScan().results)).toHaveLength(6000);
    expect(getScan().done).toBe(6000);
    expect(getScan().found).toBe(6000);
  });

  it("counts a company checked again once (its latest matches)", () => {
    dispatchScanEvent(company(1, 2));
    dispatchScanEvent(company(1, 5));
    expect(getScan().found).toBe(5);
    expect(getScan().results.Co1).toMatchObject({ matches: 5 });
  });

  it("many events in one frame tell readers once", async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useScanSelector((s) => s.done);
    });
    await nextFrame();
    renders = 0;
    for (let i = 0; i < 100; i++) dispatchScanEvent({ type: "progress", done: i + 1 } as RunEvent);
    expect(renders).toBe(0);
    await nextFrame();
    expect(renders).toBe(1);
    expect(result.current).toBe(100);
  });

  it("tells readers within 100 ms when frames don't run (a hidden tab)", async () => {
    await nextFrame();
    vi.useFakeTimers();
    const { result } = renderHook(() => useScanSelector((s) => s.done));
    dispatchScanEvent({ type: "progress", done: 7 } as RunEvent);
    await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
    expect(result.current).toBe(7);
    vi.useRealTimers();
  });

  it("returns the same snapshot while nothing changed", async () => {
    await nextFrame();
    const { result, rerender } = renderHook(() => useScanState());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    // An event that changes nothing keeps it too.
    dispatchScanEvent({ type: "unknown" } as unknown as RunEvent);
    expect(getScan()).toBe(first);
  });

  it("repeated job ids replace, not duplicate, and the jobs go when the scan's results are saved", async () => {
    const base = [makeJob({ id: "a", title: "Old" })];
    const { result } = renderHook(() => useLiveJobs(base));
    expect(result.current).toBe(base);
    dispatchScanEvent({ type: "jobs", jobs: [makeJob({ id: "a", title: "New" }), makeJob({ id: "b" })] } as RunEvent);
    dispatchScanEvent({ type: "jobs", jobs: [makeJob({ id: "b", title: "B again" })] } as RunEvent);
    await nextFrame();
    expect(result.current.map((j: Job) => [j.id, j.title])).toEqual([
      ["b", "B again"],
      ["a", "New"],
    ]);
    updateScan((s) => ({ ...s, live: [] }));
    await nextFrame();
    expect(result.current).toBe(base);
  });

  it("a new scan starts with no results and no live jobs", async () => {
    dispatchScanEvent(company(1));
    dispatchScanEvent({ type: "jobs", jobs: [makeJob({ id: "x" })] } as RunEvent);
    updateScan(() => running("mine"));
    expect(getScan().results).toEqual({});
    expect(getScan().found).toBe(0);
    const { result } = renderHook(() => useLiveJobs([]));
    await nextFrame();
    expect(result.current).toEqual([]);
  });

  it("a tab that follows later gets the same scan from the server's bounded replay (last 1,000 progress lines)", () => {
    // What the server sends: start, then each company with a progress line after it (5,000 of those).
    const events: object[] = [{ type: "start", stage: "quick", companies: [], total: 5000, byAts: { greenhouse: 5000 } }];
    for (let i = 0; i < 5000; i++) {
      // Only some companies send a line of their own (yours, matched or failed); progress carries the totals.
      if (i % 10 === 0) events.push({ ...company(i, i % 20 === 0 ? 2 : 0), done: undefined });
      events.push({ type: "progress", done: i + 1, doneByAts: { greenhouse: i + 1 }, last: `Co${i}` });
    }
    const apply = (list: object[]) => {
      resetScanStore();
      updateScan(() => running("all"));
      for (const e of list) dispatchScanEvent(e as RunEvent);
      const s = getScan();
      return { done: s.done, doneByAts: s.doneByAts, found: s.found, results: Object.keys(s.results).length, last: s.last };
    };
    const lines = scanLines(1000);
    for (const e of events) lines.push(JSON.stringify(e));
    const replayed = lines.replay().map((l) => JSON.parse(l) as object);
    expect(replayed.length).toBeLessThan(events.length);
    expect(apply(replayed)).toEqual(apply(events));
    expect(apply(replayed)).toMatchObject({ done: 5000, found: 500, results: 500 });
  });
});
