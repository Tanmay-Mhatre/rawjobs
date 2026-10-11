/**
 * Shrink the catalog's working state (scripts/catalog/out): the check and index logs are
 * append-only, so keep just the result each later step would use per board.
 *
 * Runs inside "Save the working state", also after a step was killed, so a half-written last line
 * is skipped (not fatal) and the compacted file is in place before the logs it replaces are removed.
 *
 *   pnpm exec tsx scripts/catalog/compact.ts
 */
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeCheck, type CheckRow } from "./lib/checks";

type Row = { key: string; status?: string; error?: string; fetched_at?: string; [field: string]: unknown };

/** The rows of a JSONL log; a line that isn't JSON (cut off by a kill) is skipped. */
export function readRows(path: string): { rows: Row[]; skipped: number } {
  const rows: Row[] = [];
  let skipped = 0;
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (!l) continue;
    try {
      rows.push(JSON.parse(l) as Row);
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

/** `merge` folds a board's next row into what's kept for it so far. */
export function compact(dir: string, pattern: RegExp, target: string, merge: (prev: Row | undefined, next: Row) => Row) {
  const files = readdirSync(dir).filter((n) => pattern.test(n));
  const latest = new Map<string, Row>();
  let before = 0;
  let skipped = 0;
  for (const f of files) {
    const read = readRows(join(dir, f));
    skipped += read.skipped;
    for (const r of read.rows) {
      before++;
      latest.set(r.key, merge(latest.get(r.key), r));
    }
  }
  const tmp = join(dir, `${target}.tmp`);
  writeFileSync(tmp, [...latest.values()].map((r) => JSON.stringify(r)).join("\n") + (latest.size ? "\n" : ""));
  renameSync(tmp, join(dir, target));
  for (const f of files) if (f !== target) rmSync(join(dir, f));
  console.error(`${target}: ${before} lines -> ${latest.size}${skipped ? ` (${skipped} unreadable lines skipped)` : ""}`);
}

/** Checks: the latest result wins, but a definite answer beats a later error (as in build.ts), which only extends its error streak. */
export const mergeCheckRow = (prev: Row | undefined, next: Row): Row => mergeCheck(prev as CheckRow | undefined, next as CheckRow);
/** Index: the newest successful fetch wins; an error only when there's nothing better. */
export const mergeIndexRow = (prev: Row | undefined, next: Row): Row => (keepIndex(prev, next) ? next : prev!);
const keepIndex = (prev: Row | undefined, next: Row) => {
  if (!prev) return true;
  if (next.error && !prev.error) return false;
  if (prev.error && !next.error) return true;
  return (next.fetched_at ?? "") >= (prev.fetched_at ?? "");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
  compact(OUT, /^checks(-.+)?\.jsonl$/, "checks.jsonl", mergeCheckRow);
  compact(OUT, /^index-.+\.jsonl$/, "index-all.jsonl", mergeIndexRow);
}
