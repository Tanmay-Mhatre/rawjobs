/**
 * Live-check every merged board with the cheapest call each ATS offers. No AI, no descriptions.
 * Resumable: results are appended to out/checks.jsonl; boards already checked are skipped.
 * Boards users shared ("contrib") go first. `--max-minutes N` stops starting new checks after N
 * minutes (the rest wait for the next run), so a big backlog can't stall a short run.
 *
 *   pnpm exec tsx scripts/catalog/check.ts [--max-minutes 30] [--recheck-days 30] [--ats greenhouse,lever]
 *
 * Result per board: live (has jobs) · dormant (exists, 0 jobs) · dead (404/410/422) · error (retry later)
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient } from "../../packages/core/src/index";
import { checkBoard } from "./lib/live-check";

const here = dirname(fileURLToPath(import.meta.url));
/** `--ats greenhouse,lever` limits this process to those systems; each process writes its own file. */
const atsArg = process.argv.indexOf("--ats");
const ONLY = atsArg > 0 ? new Set(process.argv[atsArg + 1]!.split(",")) : null;
const OUT_DIR = join(here, "out");
const recheckArg = process.argv.indexOf("--recheck-days");
/** Results older than this are checked again (default: never, i.e. only unchecked boards). */
const RECHECK_DAYS = recheckArg > 0 ? Number(process.argv[recheckArg + 1]) : Infinity;
const DAY_MS = 86_400_000;

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

/** A definite result stays good for --recheck-days plus the board's spread; an error is always due. */
export const isCurrent = (r: { key: string; status: string; checked_at: string }, recheckDays: number, now = Date.now()): boolean =>
  r.status !== "error" && (recheckDays === Infinity || now - Date.parse(r.checked_at) < (recheckDays + spreadDays(r.key)) * DAY_MS);
const maxArg = process.argv.indexOf("--max-minutes");
/** Stop starting new checks after this long (default: no limit). */
const MAX_MS = maxArg > 0 ? Number(process.argv[maxArg + 1]) * 60_000 : Infinity;
const OUT = join(OUT_DIR, ONLY ? `checks-${[...ONLY].sort().join("-")}.jsonl` : "checks.jsonl");
// Polite: each lane is sequential, with a small gap per host on top of request latency.
const http = new HttpClient({ retries: 2, hostDelayMs: 200, timeoutMs: 20_000, backoffMs: 3_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; low-rate board validation)" });

/**
 * Workers per hiring system. Spacing is per host (HttpClient), so extra workers on one host share
 * its gap (Greenhouse/Lever stay at most ~5 req/s), while Workday tenants are separate hosts.
 */
const WORKERS: Record<string, number> = { workday: 4, greenhouse: 2, lever: 2 };

type Board = { key: string; ats: string; slug: string; region?: string; shard?: string; site?: string; confidence: "high" | "single"; sources?: string[] };
/** Shared by users first, then boards more than one source agrees on. */
export const checkOrder = (a: Board, c: Board) =>
  Number(!!c.sources?.includes("contrib")) - Number(!!a.sources?.includes("contrib")) || (a.confidence === c.confidence ? 0 : a.confidence === "high" ? -1 : 1);
type Result = { key: string; status: "live" | "dormant" | "dead" | "error"; jobs: number | null; name?: string; http?: number; error?: string; checked_at: string };

async function main() {
  const merged = JSON.parse(readFileSync(join(here, "out", "merged.json"), "utf8")) as { boards: Board[] };
  const done = new Set<string>();
  // Results from every process (checks.jsonl and checks-*.jsonl) count as done.
  for (const f of readdirSync(OUT_DIR).filter((n) => /^checks(-.+)?\.jsonl$/.test(n))) {
    for (const line of readFileSync(join(OUT_DIR, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as Result;
      // Errors get another go; so does anything older than --recheck-days (monthly refresh).
      if (isCurrent(r, RECHECK_DAYS)) done.add(r.key);
    }
  }
  const todo = merged.boards.filter((b) => !done.has(b.key) && (!ONLY || ONLY.has(b.ats)));
  console.error(`${merged.boards.length} boards, ${done.size} already checked, ${todo.length} to go`);

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
        const row: Result = { key: b.key, ...r, checked_at: new Date().toISOString() };
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
