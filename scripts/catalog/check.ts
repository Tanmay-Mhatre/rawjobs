/**
 * Live-check every merged board with the cheapest call each ATS offers. No AI, no descriptions.
 * Resumable: results are appended to out/checks.jsonl; boards already checked are skipped.
 * Order: boards users shared ("contrib"), then boards never checked, then monthly rechecks, then
 * retries of boards that failed (each retried after a growing wait: 1, 2, 4… up to 30 days).
 * `--max-minutes N` stops starting new checks after N minutes (the rest wait for the next run), so
 * a big backlog can't stall a short run.
 *
 *   pnpm exec tsx scripts/catalog/check.ts [--max-minutes 30] [--recheck-days 30] [--ats greenhouse,lever]
 *
 * Result per board: live (has jobs) · dormant (exists, 0 jobs) · dead (404/410/422) · error (retry later)
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient } from "@rawjobs/core";
import { dueKind, isCurrent, mergeCheck, readChecks, type Due } from "./lib/checks";
import { checkBoard } from "./lib/live-check";
import { maxMsFromArgs } from "./lib/time-box";

const here = dirname(fileURLToPath(import.meta.url));
/** `--ats greenhouse,lever` limits this process to those systems; each process writes its own file. */
const atsArg = process.argv.indexOf("--ats");
const ONLY = atsArg > 0 ? new Set(process.argv[atsArg + 1]!.split(",")) : null;
const OUT_DIR = join(here, "out");
const recheckArg = process.argv.indexOf("--recheck-days");
/** Results older than this are checked again (default: never, i.e. only unchecked boards). */
const RECHECK_DAYS = recheckArg > 0 ? Number(process.argv[recheckArg + 1]) : Infinity;
/** Stop starting new checks after this long (default: no limit). */
const MAX_MS = maxMsFromArgs();
const OUT = join(OUT_DIR, ONLY ? `checks-${[...ONLY].sort().join("-")}.jsonl` : "checks.jsonl");
// Polite: each lane is sequential, with a small gap per host on top of request latency.
const http = new HttpClient({ retries: 2, hostDelayMs: 200, timeoutMs: 20_000, backoffMs: 3_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; low-rate board validation)" });

/**
 * Workers per hiring system. Spacing is per host (HttpClient), so extra workers on one host share
 * its gap (Greenhouse/Lever stay at most ~5 req/s), while Workday tenants are separate hosts.
 */
const WORKERS: Record<string, number> = { workday: 4, greenhouse: 2, lever: 2 };

type Board = { key: string; ats: string; slug: string; region?: string; shard?: string; site?: string; confidence: "high" | "single"; sources?: string[]; due?: Due };
const DUE_ORDER: Record<Due, number> = { new: 0, recheck: 1, retry: 2 };
/** Shared by users first; then never checked, monthly rechecks, retries; then boards more than one source agrees on. */
export const checkOrder = (a: Board, c: Board) =>
  Number(!!c.sources?.includes("contrib")) - Number(!!a.sources?.includes("contrib")) ||
  DUE_ORDER[a.due ?? "new"] - DUE_ORDER[c.due ?? "new"] ||
  (a.confidence === c.confidence ? 0 : a.confidence === "high" ? -1 : 1);
type Result = { key: string; status: "live" | "dormant" | "dead" | "error"; jobs: number | null; name?: string; http?: number; error?: string; checked_at: string; errors?: number };

async function main() {
  const merged = JSON.parse(readFileSync(join(here, "out", "merged.json"), "utf8")) as { boards: Board[] };
  // What's known per board, from every process's results (checks.jsonl and checks-*.jsonl).
  const known = readChecks(OUT_DIR);
  const done = new Set([...known.values()].filter((r) => isCurrent(r, RECHECK_DAYS)).map((r) => r.key));
  const todo = merged.boards.filter((b) => !done.has(b.key) && (!ONLY || ONLY.has(b.ats))).map((b): Board => ({ ...b, due: dueKind(known.get(b.key)) }));
  const dueCount = (d: Due) => todo.filter((b) => b.due === d).length;
  console.error(`${merged.boards.length} boards, ${done.size} already checked, ${todo.length} to go (${dueCount("new")} new, ${dueCount("recheck")} rechecks, ${dueCount("retry")} retries)`);

  const lanes = new Map<string, Board[]>();
  for (const b of todo.sort(checkOrder)) {
    if (!lanes.has(b.ats)) lanes.set(b.ats, []);
    lanes.get(b.ats)!.push(b);
  }

  const tally: Record<string, number> = {};
  let n = 0;
  const started = Date.now();
  await Promise.all(
    [...lanes.entries()].flatMap(([ats, list]) =>
      Array.from({ length: WORKERS[ats] ?? 1 }, async () => {
        while (list.length && Date.now() - started < MAX_MS) {
          const b = list.shift()!;
          const r = await checkBoard(http, b);
          const checked_at = new Date().toISOString();
          // An error extends the board's streak, which sets how long until its next retry.
          const row: Result = { key: b.key, ...r, checked_at, ...(r.status === "error" ? { errors: mergeCheck(known.get(b.key), { key: b.key, ...r, checked_at }).errors } : {}) };
          appendFileSync(OUT, `${JSON.stringify(row)}\n`);
          tally[r.status] = (tally[r.status] ?? 0) + 1;
          if (++n % 500 === 0) {
            const rate = n / ((Date.now() - started) / 1000);
            console.error(`  ${n}/${todo.length} (${rate.toFixed(1)}/s, ~${Math.round((todo.length - n) / rate / 60)} min left)`, JSON.stringify(tally));
          }
        }
      }),
    ),
  );
  const left = [...lanes.values()].reduce((sum, list) => sum + list.length, 0);
  console.error(left ? `Stopped after ${MAX_MS / 60_000} min: ${left} left for the next run.` : "Done.", tally);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
