import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanyHealth, Job } from "./data";
import { followScan, notifyWhenDone, runScan, stopScan, type RunEvent, type ScanScope } from "./setup";
import { load, save } from "./storage";

export type ScanState = {
  phase: "idle" | "running" | "done" | "error";
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
  /** About how long the scan takes, from the start. */
  seconds?: number;
  /** Health of your companies, and directory ones that matched or failed, by company name. */
  results: Record<string, CompanyHealth>;
  /** Matches fetched live by this scan so far, shown on the Radar before it ends (newer CLIs only). */
  live: Job[];
  /** Stop was asked for; the scan finishes the companies in progress. */
  stopping?: boolean;
  /** A Telegram message when this scan finishes: asked for, then what happened ("sent", "off", or why it failed). */
  notify?: { asked: true; result?: string };
  summary?: Extract<RunEvent, { type: "done" }>;
  error?: string;
};

const IDLE: ScanState = { phase: "idle", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: [] };
const SCOPE_KEY = "rawjobs.scanScope";
const ASK_KEY = "rawjobs.scanAsk";

/** Your default scan type (preselected in the "which scan?" pop-up, or run straight away). */
export const lastScope = (): ScanScope => (load<string>(SCOPE_KEY, "mine") === "all" ? "all" : "mine");

/** What "Scan now" does: ask which scan every time (the default), or run your default scan straight away. */
export type ScanPrefs = { scope: ScanScope; ask: boolean };
export const scanPrefs = (): ScanPrefs => ({ scope: lastScope(), ask: load<boolean>(ASK_KEY, true) !== false });
export function setScanPrefs(p: Partial<ScanPrefs>): void {
  if (p.scope) save(SCOPE_KEY, p.scope);
  if (p.ask !== undefined) save(ASK_KEY, p.ask);
  window.dispatchEvent(new Event("rawjobs:scan-prefs"));
}

/** How one event from the running scan changes what's shown ("error" is handled by the caller). */
export function applyScanEvent(s: ScanState, e: RunEvent): ScanState {
  switch (e.type) {
    case "sync":
      return { ...s, syncing: true };
    case "synced":
      return { ...s, syncing: false, sync: e.message, feed: e.feed };
    case "start":
      return {
        ...s,
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
      const { type: _, done, doneByAts, ...h } = e;
      return { ...s, done: done ?? s.done + 1, results: { ...s.results, [h.company]: h }, ...(doneByAts ? { doneByAts: { ...doneByAts } } : {}) };
    }
    case "jobs": {
      const ids = new Set(e.jobs.map((j) => j.id));
      return { ...s, live: [...s.live.filter((j) => !ids.has(j.id)), ...e.jobs] };
    }
    case "progress":
      return { ...s, done: Math.max(s.done, e.done), ...(e.doneByAts ? { doneByAts: { ...e.doneByAts } } : {}) };
    case "done":
      return { ...s, summary: e };
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

/** One progress row per hiring system, biggest first. Older CLIs send no breakdown: one row (ats "") for all companies. */
export function progressRows(scan: ScanState): { ats: string; done: number; total: number }[] {
  if (!scan.byAts || !Object.keys(scan.byAts).length) return scan.total ? [{ ats: "", done: Math.min(scan.done, scan.total), total: scan.total }] : [];
  return Object.entries(scan.byAts)
    .map(([ats, total]) => ({ ats, total, done: Math.min(scan.doneByAts?.[ats] ?? 0, total) }))
    .sort((x, y) => y.total - x.total || x.ats.localeCompare(y.ats));
}

/** One scan at a time, shared by the header button, the wizard and Radar cards. */
export function useScan(onFinished: () => void | Promise<void>) {
  const [scan, setScan] = useState<ScanState>(IDLE);
  const busy = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  /** Show a scan's events as they arrive, then refresh the page's data when it ends. */
  // biome-ignore lint/suspicious/noConfusingVoidType: streams that don't report whether they followed return void
  const watch = useCallback(async (stream: (onEvent: (e: RunEvent) => void) => Promise<boolean | void>) => {
    let failed: string | undefined;
    // biome-ignore lint/suspicious/noConfusingVoidType: holds what `stream` returns (see above)
    let followed: boolean | void = true;
    try {
      followed = await stream((e) => {
        if (e.type === "error") failed = e.message;
        else setScan((s) => applyScanEvent(s, e));
      });
    } catch (err) {
      failed = (err as Error).message;
    }
    if (followed !== false) {
      await finished.current();
      // The saved files now hold the scan's jobs: the streamed copies go.
      setScan((s) => (failed && !s.summary ? { ...s, phase: "error", error: failed, live: [] } : { ...s, phase: "done", stopping: false, live: [] }));
    }
    busy.current = false;
  }, []);

  const start = useCallback(
    async (scope: ScanScope = lastScope(), opts: { fresh?: boolean } = {}) => {
      if (busy.current) return;
      busy.current = true;
      save(SCOPE_KEY, scope);
      setScan({ ...IDLE, phase: "running", scope });
      await watch((onEvent) => runScan(onEvent, { scope, fresh: opts.fresh }));
    },
    [watch],
  );

  // A scan keeps running when the page is closed or reloaded: pick it up again when the page opens.
  useEffect(() => {
    if (busy.current) return;
    busy.current = true;
    void watch((onEvent) => followScan((scope) => setScan({ ...IDLE, phase: "running", scope }), onEvent));
  }, [watch]);

  const stop = useCallback(async () => {
    if (!busy.current) return;
    setScan((s) => ({ ...s, stopping: true }));
    await stopScan();
  }, []);

  /** "Tell me on Telegram when it's done" for the running scan. */
  const notify = useCallback(async () => {
    if (!busy.current) return false;
    const ok = await notifyWhenDone();
    if (ok) setScan((s) => ({ ...s, notify: { asked: true } }));
    return ok;
  }, []);

  const reset = useCallback(() => setScan(IDLE), []);
  return { scan, start, stop, notify, reset };
}

/** "about 2 min", "about 1.9 h". */
export function aboutTime(seconds: number): string {
  if (seconds < 90) return "about 1 min";
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

export const SCOPE_LABEL: Record<ScanScope, string> = {
  mine: "My companies + my industries",
  all: "All companies",
};

/** SCOPE_LABEL, but "My companies" alone when the "mine" scan adds no industry companies. */
export const scopeLabel = (scope: ScanScope, hasIndustries = true): string => (scope === "mine" && !hasIndustries ? "My companies" : SCOPE_LABEL[scope]);

/** "Updating the company directory…", then "Scanning 120 of 265 companies · My companies + my industries · about 2 min left". */
export function scanLine(scan: ScanState): string {
  if (scan.syncing) return "Updating the company directory…";
  if (!scan.total) return "Starting scan…";
  const left = scan.seconds && scan.total > scan.resumed ? scan.seconds * (1 - (scan.done - scan.resumed) / (scan.total - scan.resumed)) : 0;
  return [
    `Scanning ${Math.min(scan.done + 1, scan.total).toLocaleString()} of ${scan.total.toLocaleString()} companies`,
    // No directory companies on top of yours: say "My companies", not "+ my industries".
    scan.scope && scopeLabel(scan.scope, scan.total > scan.companies.length),
    left > 60 ? `${aboutTime(left)} left` : null,
    scan.skippedByFeed ? `${scan.skippedByFeed.toLocaleString()} skipped (nothing for you in the job feed)` : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
