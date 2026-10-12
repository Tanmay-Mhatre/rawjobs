import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One board's latest check, as check.ts, build.ts and compact.ts read it. */
export type CheckRow = {
  key: string;
  status: string;
  checked_at: string;
  /** Errors in a row since the last definite answer (live, dormant or dead). */
  errors?: number;
  /** On a definite row: when the latest of those errors happened. */
  last_error_at?: string;
  [field: string]: unknown;
};

const DAY_MS = 86_400_000;
/** Longest wait between two retries of a board that keeps failing. */
export const MAX_RETRY_DAYS = 30;

/**
 * Fold a board's next row into what's known about it. The latest answer wins, but a later error
 * never replaces a definite one: it only extends the error streak, which a definite answer resets.
 */
export function mergeCheck(prev: CheckRow | undefined, next: CheckRow): CheckRow {
  if (next.status !== "error") return next;
  const errors = next.errors ?? (prev?.errors ?? (prev?.status === "error" ? 1 : 0)) + 1;
  if (!prev || prev.status === "error") return { ...next, errors };
  return { ...prev, errors, last_error_at: next.checked_at };
}

/** Days to wait before retrying a board after this many errors in a row: 1, 2, 4, 8, 16, then 30. */
export const retryWaitDays = (errors: number): number => Math.min(2 ** (Math.max(errors, 1) - 1), MAX_RETRY_DAYS);

/**
 * 0-6 extra days per board, fixed by its key (FNV-1a). Boards first checked together (some 40,000
 * between 4 and 10 Oct 2026) then come due over a week instead of in one run, so a monthly recheck
 * can't move the live count by 10% at once and trip the release gate.
 */
export const spreadDays = (key: string): number => {
  let h = 0x811c9dc5;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h % 7;
};

/**
 * Whether a board's latest check still stands. A failing board is retried after a growing wait
 * (retryWaitDays), so the ~1,000 boards that keep failing don't take every run's time; a definite
 * answer stands for --recheck-days plus the board's spread.
 */
export function isCurrent(r: CheckRow, recheckDays: number, now = Date.now()): boolean {
  if (r.errors || r.status === "error") {
    const last = Date.parse(r.last_error_at ?? r.checked_at);
    return now - last < retryWaitDays(r.errors ?? 1) * DAY_MS;
  }
  return recheckDays === Infinity || now - Date.parse(r.checked_at) < (recheckDays + spreadDays(r.key)) * DAY_MS;
}

/** Why a board is due, in the order a run checks them: never checked, monthly recheck, retry of an error. */
export type Due = "new" | "recheck" | "retry";
export const dueKind = (r: CheckRow | undefined): Due => (!r ? "new" : r.errors || r.status === "error" ? "retry" : "recheck");

/**
 * Every board's latest check, from all of `dir`'s checks.jsonl and checks-*.jsonl (each check
 * process writes its own), folded with mergeCheck. A line cut off by a kill (capped.sh sends KILL a
 * minute after TERM) is skipped, not fatal. `settle` adjusts each row before it's folded in.
 */
export function readChecks(dir: string, settle: (row: CheckRow) => CheckRow = (row) => row): Map<string, CheckRow> {
  const rows: CheckRow[] = [];
  for (const f of readdirSync(dir).filter((n) => /^checks(-.+)?\.jsonl$/.test(n))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        rows.push(settle(JSON.parse(line) as CheckRow));
      } catch {
        // half a line
      }
    }
  }
  // In time order across all the files, so "latest" means the latest check, not the last file read.
  rows.sort((a, b) => (a.checked_at < b.checked_at ? -1 : a.checked_at > b.checked_at ? 1 : 0));
  const known = new Map<string, CheckRow>();
  for (const row of rows) known.set(row.key, mergeCheck(known.get(row.key), row));
  return known;
}
