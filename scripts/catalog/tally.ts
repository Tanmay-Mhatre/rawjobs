/**
 * What the catalog's working state holds, and how much of it this run added: board checks, company
 * lookups, and the two URL indexes. Printed as Markdown for a workflow's run summary, so a run can be
 * compared with the last one (the proof that a faster rebuild dropped nothing).
 *
 *   pnpm exec tsx scripts/catalog/tally.ts --since 2026-10-21T03:07:00Z >> "$GITHUB_STEP_SUMMARY"
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readChecks } from "./lib/checks";
import { catalogDir } from "./lib/paths";

export type TallyRow = { what: string; total: number; thisRun: string; detail: string };

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);
/** "dead 3, live 40": how many of each value, in name order. */
const counts = (values: string[]) => {
  const by: Record<string, number> = {};
  for (const v of values) by[v] = (by[v] ?? 0) + 1;
  return Object.entries(by)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
};

/** `since` is an ISO time; rows checked, resolved or saved at or after it count as this run's. */
export function tally(dir: string, since: string): TallyRow[] {
  const rows: TallyRow[] = [];
  const out = join(dir, "out");

  if (existsSync(out)) {
    const checks = [...readChecks(out).values()];
    const fresh = checks.filter((r) => r.checked_at >= since);
    rows.push({ what: "Board checks", total: checks.length, thisRun: String(fresh.length), detail: counts(fresh.map((r) => r.status)) });
  }

  const lookups = ["resolved.json", "resolved-bulk.json"].flatMap((f) => readJson<{ companies: { status: string; resolved_at: string }[] }>(join(out, f))?.companies ?? []);
  if (lookups.length) {
    const fresh = lookups.filter((c) => c.resolved_at >= since);
    rows.push({ what: "Company lookups", total: lookups.length, thisRun: String(fresh.length), detail: counts(fresh.map((c) => c.status)) });
  }

  const wayback = readJson<{ generated_at: string; completed_at?: string; boards: unknown[] }>(join(dir, "raw", "wayback", "boards.json"));
  if (wayback) rows.push(indexRow("Wayback boards", wayback, since, wayback.completed_at ? `pass completed ${wayback.completed_at.slice(0, 10)}` : "pass in progress"));
  const crawl = readJson<{ generated_at: string; crawls?: string[]; boards: unknown[] }>(join(dir, "raw", "commoncrawl", "boards.json"));
  if (crawl) rows.push(indexRow("Common Crawl boards", crawl, since, `${crawl.crawls?.length ?? 0} crawls read`));
  return rows;
}

function indexRow(what: string, saved: { generated_at: string; boards: unknown[] }, since: string, detail: string): TallyRow {
  const updated = saved.generated_at >= since;
  return { what, total: saved.boards.length, thisRun: updated ? "updated" : `last ${saved.generated_at.slice(0, 16).replace("T", " ")}`, detail };
}

export const tallyMarkdown = (rows: TallyRow[]): string =>
  ["#### Working state", "", "| What | Total | This run | Detail |", "|---|---|---|---|", ...rows.map((r) => `| ${r.what} | ${r.total} | ${r.thisRun} | ${r.detail} |`), ""].join("\n");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sinceArg = process.argv.indexOf("--since");
  const since = new Date(sinceArg > 0 ? process.argv[sinceArg + 1]! : 0).toISOString();
  console.log(tallyMarkdown(tally(catalogDir, since)));
}
