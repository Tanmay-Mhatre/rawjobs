import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanyHealth, Job } from "./data";
import { toast } from "../components/Toast";
import { followScan, notifyWhenDone, runScan, stopScan, type RunEvent, type ScanScope, type ScanSource } from "./setup";
import { load, save } from "./storage";

export type ScanState = {
  /** "background": Scan now is done and saved; the quiet check of every other company runs (`bg`). */
  phase: "idle" | "running" | "background" | "done" | "error";
  /** Updating the shared directory, before any company is fetched. */
  syncing?: boolean;
  /** What the directory sync said ("Already up to date.", "Updated to …", offline). */
  sync?: string;
  /** What the job feed sync said ("Job feed is up to date (today).", stale, unavailable). */
  feed?: string;
  /** Directory companies the job feed let this scan skip. */
  skippedByFeed?: number;
  scope?: ScanScope;
  /** Your companies' names, in run order; health arrives as each finishes. */
  companies: string[];
  /** Companies this scan covers (yours + directory ones), and how many are done. */
  total: number;
  done: number;
  /** Done before this scan started (it resumed a stopped one). */
  resumed: number;
  /** Companies this scan covers per hiring system, and how many of each are done (newer CLIs only). */
  byAts?: Record<string, number>;
  doneByAts?: Record<string, number>;
  /** Scan now's companies by where they come from (yours, past matches, feed picks), and how many are done. */
  bySource?: Record<ScanSource, number>;
  doneBySource?: Record<ScanSource, number>;
  /** The shared job feed is too old to pick companies: this Scan now checks every company itself. */
  fallback?: boolean;
  /** How old the shared job feed is, in days (null: none). */
  feedAgeDays?: number | null;
  /** The background check after Scan now: its progress, and what it found when it ended. */
  bg?: Background;
  /** When this page started (or picked up) the scan, the directory sync began and ended (ms): the starting steps. */
  startedAt?: number;
  syncAt?: number;
  syncedAt?: number;
  /** The company checked last and when (ms): shows the scan is alive, or stuck on a slow site. */
  last?: string;
  lastAt?: number;
  /** About how long the scan takes, from the start. */
  seconds?: number;
  /** Health of your companies, and directory ones that matched or failed, by company name. */
  results: Record<string, CompanyHealth>;
  /** Matches fetched live by this scan so far, shown on the Radar before it ends (newer CLIs only). */
  live: Job[];
  /** Stop was asked for; the scan ends within seconds. */
  stopping?: boolean;
  /** A Telegram message when this scan finishes: asked for, then what happened ("sent", "off", or why it failed). */
  notify?: { asked: true; result?: string };
  summary?: Extract<RunEvent, { type: "done" }>;
  error?: string;
};

export type Background = {
  total: number;
  done: number;
  resumed: number;
  seconds?: number;
  found: number;
  /** Companies it couldn't fetch so far. */
  failed: number;
  /** When it began (ms), and the company it checked last and when. */
  startedAt?: number;
  last?: string;
  lastAt?: number;
  pausing?: boolean;
  /** How it ended: `stopped` when it was paused (Resume now carries it on). */
  summary?: Extract<RunEvent, { type: "done" }>;
};

const IDLE: ScanState = { phase: "idle", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: [] };
const newBackground = (): Background => ({ total: 0, done: 0, resumed: 0, found: 0, failed: 0, startedAt: Date.now() });
const running = (scope?: ScanScope): ScanState => ({ ...IDLE, phase: "running", scope, startedAt: Date.now() });

/** No company finished for this long: say a slow site is holding it up. */
export const STALL_MS = 45_000;
/** A starting step taking this long says why. */
export const SLOW_STEP_MS = 30_000;
const SCOPE_KEY = "rawjobs.scanScope";

/** What Scan now runs. */
export type QuickScope = Extract<ScanScope, "mine" | "yours">;

/**
 * What "Scan now" runs: the scan ("mine", the default) or only your companies. Saved choices from
 * before carry over: "Always: All companies" is the scan now, as the background check covers the rest.
 */
export const lastScope = (): QuickScope => (load<string>(SCOPE_KEY, "mine") === "yours" ? "yours" : "mine");

export type ScanPrefs = { scope: QuickScope };
export const scanPrefs = (): ScanPrefs => ({ scope: lastScope() });
export function setScanPrefs(p: Partial<ScanPrefs>): void {
  if (p.scope) save(SCOPE_KEY, p.scope);
  window.dispatchEvent(new Event("rawjobs:scan-prefs"));
}

/** How one event from the running scan changes what's shown ("error" is handled by the caller). */
export function applyScanEvent(s: ScanState, e: RunEvent): ScanState {
  switch (e.type) {
    case "sync":
      return { ...s, syncing: true, syncAt: Date.now() };
    case "synced":
      return { ...s, syncing: false, sync: e.message, feed: e.feed, syncedAt: Date.now() };
    case "start":
      if (e.stage === "background")
        return {
          ...s,
          bg: { ...(s.bg ?? newBackground()), total: e.total ?? 0, done: e.resumed ?? 0, resumed: e.resumed ?? 0, seconds: e.seconds, found: 0, failed: 0, lastAt: Date.now() },
        };
      return {
        ...s,
        lastAt: Date.now(),
        bySource: e.bySource,
        doneBySource: e.bySource ? { ...(e.doneBySource ?? { yours: 0, past: 0, feed: 0 }) } : undefined,
        fallback: e.fallback,
        feedAgeDays: e.feedAgeDays,
        syncing: false,
        companies: e.companies,
        total: e.total ?? e.companies.length,
        done: e.resumed ?? 0,
        resumed: e.resumed ?? 0,
        seconds: e.seconds,
        skippedByFeed: e.skippedByFeed,
        byAts: e.byAts,
        doneByAts: e.byAts ? { ...e.doneByAts } : undefined,
      };
    case "company": {
      const { type: _, done, doneByAts, doneBySource, ...h } = e;
      const seen = { last: h.company, lastAt: Date.now() };
      if (s.bg) return { ...s, bg: { ...s.bg, ...seen, done: done ?? s.bg.done + 1, found: s.bg.found + (h.ok ? h.matches : 0), failed: s.bg.failed + (!h.ok && !h.unsupported ? 1 : 0) } };
      return {
        ...s,
        ...seen,
        done: done ?? s.done + 1,
        results: { ...s.results, [h.company]: h },
        ...(doneByAts ? { doneByAts: { ...doneByAts } } : {}),
        ...(doneBySource ? { doneBySource: { ...doneBySource } } : {}),
      };
    }
    case "jobs": {
      const ids = new Set(e.jobs.map((j) => j.id));
      return { ...s, live: [...s.live.filter((j) => !ids.has(j.id)), ...e.jobs] };
    }
    case "progress": {
      const seen = { last: e.last ?? (s.bg ?? s).last, lastAt: Date.now() };
      if (s.bg) return { ...s, bg: { ...s.bg, ...seen, done: Math.max(s.bg.done, e.done) } };
      return { ...s, ...seen, done: Math.max(s.done, e.done), ...(e.doneByAts ? { doneByAts: { ...e.doneByAts } } : {}), ...(e.doneBySource ? { doneBySource: { ...e.doneBySource } } : {}) };
    }
    case "done":
      if (e.stage === "background") return { ...s, bg: { ...(s.bg ?? newBackground()), pausing: false, summary: e } };
      return { ...s, summary: e };
    case "background":
      return { ...s, phase: "background", stopping: false, bg: newBackground() };
    case "notified":
      return { ...s, notify: { asked: true, result: e.result } };
    default:
      return s;
  }
}

/**
 * The Radar's jobs with a running scan's matches: a job fetched again is updated in place (keeping what
 * only the saved files know, like its industries), a new one is added at the top. The saved files replace
 * all of it when the scan ends.
 */
export function withLive(jobs: Job[], live: readonly Job[]): Job[] {
  if (!live.length) return jobs;
  const fresh = new Map(live.map((j) => [j.id, j]));
  const updated = jobs.map((j) => {
    const l = fresh.get(j.id);
    if (!l) return j;
    fresh.delete(j.id);
    return { ...j, ...l, companyKey: j.companyKey, industries: j.industries, visa: j.visa };
  });
  return [...fresh.values(), ...updated];
}

/** "Scan done: 12 new matches." */
const newMatchesLine = (n: number) => (n === 1 ? "1 new match" : `${n.toLocaleString()} new matches`);

/**
 * Scan now's progress by where its companies come from (the details popover): the shared feed (done by
 * the time companies are fetched), your companies, past matches, the feed's picks. Null for scans
 * that don't say (older CLIs, Only my companies, Check every company).
 */
export function sourceRows(scan: ScanState): { label: string; done: number; total: number; feed?: true }[] | null {
  if (!scan.bySource || scan.fallback) return null;
  const done = scan.doneBySource ?? { yours: 0, past: 0, feed: 0 };
  const row = (label: string, k: ScanSource) => ({ label, total: scan.bySource![k], done: Math.min(done[k], scan.bySource![k]) });
  return [{ label: "Shared feed", done: 1, total: 1, feed: true }, row("Your companies", "yours"), row("Past matches", "past"), row("Feed picks", "feed")];
}

/** One progress row per hiring system, biggest first. Older CLIs send no breakdown: one row (ats "") for all companies. */
export function progressRows(scan: ScanState): { ats: string; done: number; total: number }[] {
  if (!scan.byAts || !Object.keys(scan.byAts).length) return scan.total ? [{ ats: "", done: Math.min(scan.done, scan.total), total: scan.total }] : [];
  return Object.entries(scan.byAts)
    .map(([ats, total]) => ({ ats, total, done: Math.min(scan.doneByAts?.[ats] ?? 0, total) }))
    .sort((x, y) => y.total - x.total || x.ats.localeCompare(y.ats));
}

/**
 * Progress rows split for a short list: up to `limit` unfinished ones (in the order given, so rows
 * never jump), the rest of the unfinished, and the finished. Lists of `limit` rows or fewer stay
 * whole and in place (`inPlace`).
 */
export function splitProgress<R extends { done: number; total: number; feed?: true }>(rows: R[], limit: number): { shown: R[]; rest: R[]; done: R[]; inPlace: boolean } {
  if (rows.length <= limit) return { shown: rows, rest: [], done: [], inPlace: true };
  const finished = (r: R) => !!r.feed || r.done >= r.total;
  const open = rows.filter((r) => !finished(r));
  return { shown: open.slice(0, limit), rest: open.slice(limit), done: rows.filter(finished), inPlace: false };
}

/** One scan at a time, shared by the header button, the wizard and Radar cards. */
export function useScan(onFinished: () => void | Promise<void>) {
  const [scan, setScan] = useState<ScanState>(IDLE);
  const busy = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  /** The stream being shown: a new scan replaces a background check's, whose last events are then ignored. */
  const generation = useRef(0);
  const phase = useRef<ScanState["phase"]>("idle");
  /** A scan to start once the running one has stopped ("Only my companies" on the stale-feed notice). */
  const next = useRef<ScanScope | null>(null);
  const startRef = useRef<(scope: ScanScope) => Promise<void>>(async () => {});
  phase.current = scan.phase;
  /**
   * Show a scan's events as they arrive, then refresh the page's data when it ends. `following`: a scan
   * already running, replayed from its start: its "Scan done" toast was already shown.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: streams that don't report whether they followed return void
  const watch = useCallback(async (stream: (onEvent: (e: RunEvent) => void) => Promise<boolean | void>, following = false) => {
    const mine = ++generation.current;
    const current = () => generation.current === mine;
    let failed: string | undefined;
    let quickNew = 0;
    let bgDone: Extract<RunEvent, { type: "done" }> | undefined;
    // biome-ignore lint/suspicious/noConfusingVoidType: holds what `stream` returns (see above)
    let followed: boolean | void = true;
    try {
      followed = await stream((e) => {
        if (!current()) return;
        if (e.type === "error") failed = e.message;
        else setScan((s) => applyScanEvent(s, e));
        if (e.type === "done" && e.stage !== "background") quickNew = e.newMatches;
        if (e.type === "done" && e.stage === "background") bgDone = e;
        if (e.type === "background") {
          // Scan now is saved: show it, then say the rest is being checked.
          void Promise.resolve(finished.current()).then(() => current() && setScan((s) => ({ ...s, live: [] })));
          if (!following) toast({ message: `Scan done: ${quickNew ? newMatchesLine(quickNew) : "no new matches"}. Checking the rest in the background.`, actionLabel: "Dismiss", onAction: () => {} });
        }
      });
    } catch (err) {
      failed = (err as Error).message;
    }
    if (!current()) return;
    if (followed !== false) {
      await finished.current();
      if (!current()) return;
      // The saved files now hold the scan's jobs: the streamed copies go.
      setScan((s) => (failed && !s.summary ? { ...s, phase: "error", error: failed, live: [] } : { ...s, phase: "done", stopping: false, live: [] }));
      // Quiet unless it found something: no toast for a background check that found nothing or was paused.
      if (bgDone && !bgDone.stopped && bgDone.newMatches > 0)
        toast({
          message: `Background check found ${bgDone.newMatches === 1 ? "1 more match" : `${bgDone.newMatches.toLocaleString()} more matches`}.`,
          actionLabel: "Show",
          onAction: () => document.querySelector<HTMLElement>("[data-job-link]")?.focus(),
          duration: 10_000,
        });
    }
    busy.current = false;
    if (next.current) {
      const scope = next.current;
      next.current = null;
      void startRef.current(scope);
    }
  }, []);

  const start = useCallback(
    async (scope: ScanScope = lastScope(), opts: { fresh?: boolean } = {}) => {
      // A background check gives way to a new scan (the server stops it; it carries on after).
      if (busy.current && phase.current !== "background") return;
      busy.current = true;
      save(SCOPE_KEY, scope);
      setScan(running(scope));
      await watch((onEvent) => runScan(onEvent, { scope, fresh: opts.fresh }));
    },
    [watch],
  );

  // A scan keeps running when the page is closed or reloaded: pick it up again when the page opens.
  useEffect(() => {
    if (busy.current) return;
    busy.current = true;
    void watch((onEvent) => followScan((scope) => setScan(running(scope)), onEvent), true);
  }, [watch]);

  startRef.current = start;

  const stop = useCallback(async () => {
    if (!busy.current) return;
    setScan((s) => (s.phase === "background" && s.bg ? { ...s, bg: { ...s.bg, pausing: true } } : { ...s, stopping: true }));
    await stopScan();
  }, []);

  /** Resume now: carry on a paused background check, from where it stopped. */
  const resume = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setScan((s) => ({ ...s, phase: "background", bg: newBackground(), summary: undefined }));
    // `following`: no "Scan done" toast, as no Scan now ran.
    await watch((onEvent) => runScan(onEvent, { background: true }), true);
  }, [watch]);

  /** "Tell me on Telegram when it's done" for the running scan. */
  const notify = useCallback(async () => {
    if (!busy.current) return false;
    const ok = await notifyWhenDone();
    if (ok) setScan((s) => ({ ...s, notify: { asked: true } }));
    return ok;
  }, []);

  /** Stop the running scan (what's done is kept), then start this one. */
  const restart = useCallback(
    async (scope: ScanScope) => {
      if (!busy.current) return start(scope);
      next.current = scope;
      await stop();
    },
    [start, stop],
  );

  const reset = useCallback(() => setScan(IDLE), []);
  return { scan, start, stop, restart, notify, reset, resume };
}

/** "about 2 min", "about 1.9 h". */
export function aboutTime(seconds: number): string {
  if (seconds < 90) return "about 1 min";
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

export const SCOPE_LABEL: Record<ScanScope, string> = {
  mine: "Scan",
  yours: "Only my companies",
  all: "Every company",
};

/** SCOPE_LABEL (the second argument is kept for older callers). */
export const scopeLabel = (scope: ScanScope, _hasIndustries = true): string => SCOPE_LABEL[scope];

/** "about 2 min left", from the start's estimate and the share done since. */
function timeLeft(seconds: number | undefined, total: number, done: number, resumed: number): number {
  return seconds && total > resumed ? seconds * (1 - (done - resumed) / (total - resumed)) : 0;
}

/** "Updating the company directory…", then "Checking 126 of 300 companies · about 2 min left". */
export function scanLine(scan: ScanState): string {
  if (scan.syncing) return "Updating the company directory…";
  if (!scan.total) return "Starting scan…";
  const left = timeLeft(scan.seconds, scan.total, scan.done, scan.resumed);
  return [
    `Checking ${Math.min(scan.done + 1, scan.total).toLocaleString()} of ${scan.total.toLocaleString()} companies`,
    scan.scope && scan.scope !== "mine" ? SCOPE_LABEL[scan.scope] : null,
    left > 60 ? `${aboutTime(left)} left` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The background check's details: "1,170 done · about 50 min left". */
export function backgroundLine(bg: Background): string {
  if (!bg.total) return "Starting…";
  return [`${Math.min(bg.done, bg.total).toLocaleString()} done`, backgroundLeft(bg)].filter(Boolean).join(" · ");
}

/** "about 50 min left", or "" when it's nearly done or not known. */
export function backgroundLeft(bg: Background): string {
  const left = timeLeft(bg.seconds, bg.total, bg.done, bg.resumed);
  return left > 60 ? `${aboutTime(left)} left` : "";
}

/** A running time: "0:07", "12:30", "1:02:05". */
export function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const [h, m, s] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** How long a step took: "2s", "3 min". */
export const took = (ms: number): string => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)} min`);

/** "just now", "12s ago", "3 min ago". */
export function ago(ms: number): string {
  if (ms < 5_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)} min ago`;
}

export type Step = { label: string; detail?: string; state: "done" | "now" | "todo"; ms?: number };

/** Scan now's steps before it knows how many companies it covers: opening, the directory, choosing. */
export function startingSteps(scan: ScanState, now: number): Step[] {
  const { startedAt = now, syncAt, syncedAt } = scan;
  const synced = [scan.sync, scan.feed]
    .filter(Boolean)
    .map((m) => m!.replace(/\.$/, ""))
    .join(" · ");
  const slow = syncAt && !syncedAt && now - syncAt > SLOW_STEP_MS;
  return [
    syncAt ? { label: "Opened the scanner", state: "done", ms: syncAt - startedAt } : { label: "Opening the scanner", state: "now" },
    syncedAt
      ? { label: "Updated the company directory", detail: synced || undefined, state: "done", ms: syncedAt - (syncAt ?? startedAt) }
      : {
          label: "Updating the company directory",
          state: syncAt ? "now" : "todo",
          ...(slow ? { detail: "Downloading the latest list: can take a minute on slow connections", ms: now - syncAt } : {}),
        },
    {
      label: "Choosing which companies to check",
      state: syncedAt ? "now" : "todo",
      ...(syncedAt
        ? scan.scope === "yours"
          ? { detail: "Your companies" }
          : scan.scope === "all"
            ? { detail: "Every company in the directory" }
            : now - syncedAt > SLOW_STEP_MS
              ? { detail: "Matching the job feed to your profile: can take a minute", ms: now - syncedAt }
              : { detail: "Your companies, past matches and feed picks" }
        : {}),
    },
  ];
}

/** The background check's steps before it knows how many companies are left. */
export function backgroundSteps(scan: ScanState): Step[] {
  const quick = scan.summary && scan.summary.stage !== "background" ? scan.summary : undefined;
  return [
    quick
      ? { label: "Saved Scan now's results", detail: quick.newMatches ? `${newMatchesLine(quick.newMatches)} on your Radar` : "No new matches", state: "done" }
      : { label: "Picked up where it stopped", state: "done" },
    { label: "Listing the companies Scan now skipped", state: "now" },
  ];
}

/** "about 60 to 70 min": a long estimate as an honest range (the speed of thousands of sites varies). */
export function aboutRange(seconds: number): string {
  if (seconds < 1200) return aboutTime(seconds);
  const lo = Math.max(1, Math.floor(seconds / 600)) * 10;
  return lo >= 120 ? `about ${(lo / 60).toFixed(0)} to ${((lo + 30) / 60).toFixed(1)} h` : `about ${lo} to ${lo + 10} min`;
}

/** Scan preferences, kept in step across the page (header button, pop-up, Settings). */
export function useScanPrefs(): ScanPrefs {
  const [prefs, setPrefs] = useState(scanPrefs);
  useEffect(() => {
    const changed = () => setPrefs(scanPrefs());
    window.addEventListener("rawjobs:scan-prefs", changed);
    return () => window.removeEventListener("rawjobs:scan-prefs", changed);
  }, []);
  return prefs;
}
