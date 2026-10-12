import type { CompanyHealth } from "./data";

/** A company with nothing for you in at least this many scans in a row, over at least QUIET_DAYS, gets a "remove?" flag. */
export const QUIET_SCANS = 10;
/** ...so ten quick scans in one afternoon don't count. */
export const QUIET_DAYS = 7;
/** Rows per page in My companies. */
export const MY_PAGE = 25;
/** Bars per row: the last few scans. */
export const BAR_SCANS = 5;

/** One scan that included the company: its health and when the scan started. */
export type Seen = { h: CompanyHealth; at: string };

/** Scans in a row (newest first) that found nothing for you, and since when. */
export type Quiet = { scans: number; since?: string };

export function quietOf(seen: readonly Seen[]): Quiet {
  let scans = 0;
  let since: string | undefined;
  for (const { h, at } of seen) {
    if (!h.ok || h.matches > 0) break;
    scans++;
    since = at;
  }
  return { scans, since };
}

export const isQuiet = (q: Quiet, now = Date.now()) => q.scans >= QUIET_SCANS && !!q.since && now - Date.parse(q.since) >= QUIET_DAYS * 86_400_000;

/**
 * What's wrong with a company, if anything. Healthy rows have no problem (and show no status):
 * - notFound: its careers page answered 404 (it isn't at the saved address), since the first scan of the streak.
 * - notAnswering: any other failure, on the last scan or since the first of several.
 * - cantRead: a hiring system RawJobs can't read yet. Not the company's fault, and nothing to fix.
 * - notChecked: no scan has included it yet.
 */
export type Problem = { kind: "notFound"; since: string } | { kind: "notAnswering"; since: string; scans: number } | { kind: "cantRead" } | { kind: "notChecked"; afterLastScan: boolean } | null;

const failed = (h: CompanyHealth) => !h.ok && !h.unsupported;

export function problemOf(seen: readonly Seen[], opts: { unreadable?: boolean; anyScans: boolean }): Problem {
  const last = seen[0];
  if (!last) return opts.unreadable ? { kind: "cantRead" } : { kind: "notChecked", afterLastScan: opts.anyScans };
  if (last.h.unsupported) return { kind: "cantRead" };
  if (!failed(last.h)) return null;
  let scans = 0;
  let since = last.at;
  for (const { h, at } of seen) {
    if (!failed(h)) break;
    scans++;
    since = at;
  }
  return /\(404\)/.test(last.h.error ?? "") ? { kind: "notFound", since } : { kind: "notAnswering", since, scans };
}

/** Its last scan failed: it needs you (a new link, or another try). */
export const needsAttention = (p: Problem) => p?.kind === "notFound" || p?.kind === "notAnswering";

export type Filter = "all" | "attention" | "quiet" | "new";

/** What the filter chips test, per row. */
export type Facts = { problem: Problem; quiet: boolean };

export const matchesFilter = (f: Filter, x: Facts) => (f === "all" ? true : f === "attention" ? needsAttention(x.problem) : f === "quiet" ? x.quiet : x.problem?.kind === "notChecked");

export function filterCounts(rows: readonly Facts[]): Record<Filter, number> {
  const out: Record<Filter, number> = { all: 0, attention: 0, quiet: 0, new: 0 };
  for (const x of rows) for (const f of ["all", "attention", "quiet", "new"] as const) if (matchesFilter(f, x)) out[f]++;
  return out;
}

/** The rows on page `page` (1-based), with the page clamped to the ones there are. */
export function pageOf<T>(rows: readonly T[], page: number, size = MY_PAGE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages };
}

/** One bar per recent scan, oldest first: worked, failed, or not checked (left out, or a system RawJobs can't read). */
export type Bar = { state: "worked" | "failed" | "none"; at: string };

export function barsOf(runs: readonly { startedAt: string; health: readonly CompanyHealth[] }[], find: (health: readonly CompanyHealth[]) => CompanyHealth | undefined, n = BAR_SCANS): Bar[] {
  return runs
    .slice(0, n)
    .map((run): Bar => {
      const h = find(run.health);
      return { state: !h || h.unsupported ? "none" : h.ok ? "worked" : "failed", at: run.startedAt };
    })
    .reverse();
}

/** "Last 5 scans: 4 worked, 1 failed" for screen readers (the bars are visual only). */
export function barsSummary(bars: readonly Bar[]): string {
  if (!bars.length) return "Not checked yet";
  const n = (s: Bar["state"]) => bars.filter((b) => b.state === s).length;
  return [`Last ${bars.length} scan${bars.length === 1 ? "" : "s"}: ${n("worked")} worked`, n("failed") && `${n("failed")} failed`, n("none") && `${n("none")} not checked`].filter(Boolean).join(", ");
}
