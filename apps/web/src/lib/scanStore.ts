import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import type { CompanyHealth, Job } from "./data";
import { applyScanEvent, publishProgress, type ScanState, withLive } from "./scan";
import type { RunEvent } from "./setup";

/**
 * The scan being shown, outside React state. A scan sends an event per company (thousands in an All
 * companies scan); copying the per-company results on each one made a long scan quadratic, and every event
 * re-rendered the whole app. Here each event changes the store in place in O(1), and readers hear about it
 * at most once a frame. Readers subscribe to just what they show (useScanSelector), so App and the Radar
 * don't re-render on progress. The page sees every scan through the same events: one it started, and the
 * schedule's or a terminal's, which it follows through GET /api/run.
 */
export type ScanSnapshot = ScanState & {
  /** Matches found so far by Scan now, summed as companies finish. */
  found: number;
  /** Goes up when `results` changes (it's changed in place). */
  resultsVersion: number;
  /** Goes up when the live jobs change (useLiveJobs()). `live` itself stays empty in the snapshot. */
  liveVersion: number;
};

const NO_JOBS: Job[] = [];
export const IDLE: ScanState = { phase: "idle", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: NO_JOBS };

/** Health by company, changed in place: the snapshot's `results` is this object until a new scan starts. */
let results: Record<string, CompanyHealth> = {};
/** Jobs this scan fetched so far, by id: a job fetched again replaces its copy. */
const live = new Map<string, Job>();
/** The latest state, and the one readers see (published at most once a frame). */
let snap: ScanSnapshot = { ...IDLE, results, found: 0, resultsVersion: 0, liveVersion: 0 };
let shown = snap;
const subs = new Set<() => void>();
let queued = false;

function flush() {
  if (!queued) return;
  queued = false;
  shown = snap;
  publishProgress(shown);
  for (const fn of subs) fn();
}

/**
 * Tell readers once per frame, however many events arrived in it. The timer covers a hidden tab, where
 * frames don't run but the scan still ends and its results load.
 */
function schedule() {
  if (queued) return;
  queued = true;
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  setTimeout(flush, 100);
}

const sum = (r: Record<string, CompanyHealth>) => Object.values(r).reduce((n, h) => n + (h.ok ? h.matches : 0), 0);

/** The state now, including what readers haven't been told about yet. */
export const getScan = (): ScanSnapshot => snap;

/**
 * Change the state: `fn` gets the current one and returns the next (or the same, for no change). A next state
 * with other `results` (a new scan, from IDLE) starts the results afresh; `live: []` lets the live jobs go.
 */
export function updateScan(fn: (s: ScanSnapshot) => ScanState): void {
  const next = fn(snap);
  if (next === snap) return;
  let { found, resultsVersion, liveVersion } = snap;
  if (next.results !== results) {
    results = { ...next.results };
    found = sum(results);
    resultsVersion++;
    if (live.size) {
      live.clear();
      liveVersion++;
    }
  }
  if (next.live !== snap.live) {
    live.clear();
    for (const j of next.live) live.set(j.id, j);
    liveVersion++;
  }
  snap = { ...next, results, live: NO_JOBS, found, resultsVersion, liveVersion };
  schedule();
}

/** One event from the running scan ("error" is handled by the caller). */
export function dispatchScanEvent(e: RunEvent): void {
  if (e.type === "company" && !snap.bg) {
    const { type: _, done: _d, doneByAts: _a, doneBySource: _s, ...h } = e;
    // Everything but the results, from the shared reducer (given no results, so it copies none).
    const next = applyScanEvent({ ...snap, results: {} }, e);
    const before = results[h.company];
    results[h.company] = h;
    const found = snap.found + (h.ok ? h.matches : 0) - (before?.ok ? before.matches : 0);
    snap = { ...snap, ...next, results, live: NO_JOBS, found, resultsVersion: snap.resultsVersion + 1 };
  } else if (e.type === "jobs") {
    for (const j of e.jobs) live.set(j.id, j);
    snap = { ...snap, liveVersion: snap.liveVersion + 1 };
  } else {
    const next = applyScanEvent(snap, e);
    if (next === snap) return;
    snap = { ...snap, ...next };
  }
  schedule();
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/**
 * A part of the scan, re-rendering only when it changes. Return a primitive or a part of the snapshot
 * (`s => s.phase`, `s => s.summary`), never a new object or array.
 */
export function useScanSelector<T>(select: (s: ScanSnapshot) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(shown),
    () => select(shown),
  );
}

/** The whole scan, for the parts of the page that show it (the Scan button, the progress list). */
export const useScanState = (): ScanSnapshot => useScanSelector((s) => s);
/**
 * Renders `children` with the scan, re-rendering on its own as the scan moves: lets a parent that doesn't
 * read the scan (App) place the parts that show it.
 */
export function ScanView({ children }: { children: (scan: ScanSnapshot) => ReactNode }): ReactNode {
  return children(useScanState());
}
export const useScanPhase = (): ScanState["phase"] => useScanSelector((s) => s.phase);

/** `jobs` with the running scan's matches (see withLive), worked out again only when those change. */
export function useLiveJobs(jobs: Job[]): Job[] {
  const version = useScanSelector((s) => s.liveVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` says when the live Map changed
  return useMemo(() => (live.size ? withLive(jobs, [...live.values()]) : jobs), [jobs, version]);
}

/** Back to no scan, told at once (tests). */
export function resetScanStore(): void {
  results = {};
  live.clear();
  snap = { ...IDLE, results, found: 0, resultsVersion: 0, liveVersion: 0 };
  queued = true;
  flush();
}
