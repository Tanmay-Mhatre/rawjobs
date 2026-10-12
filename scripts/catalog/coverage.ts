/**
 * How well can we track the companies that matter per industry? Reads the seed list, what
 * resolve.ts found for each seed, and the published directory; writes out/coverage.md with
 * per-industry coverage and the hiring systems worth building a connector for next.
 *
 * First section: the Universe (lib/universe.ts), how much of each hiring system the directory
 * holds, measured on an independent Wikidata sample (resolve.ts --bulk).
 *
 *   pnpm exec tsx scripts/catalog/coverage.ts [--data <dir>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { companyKey, connectors, detectCompany, INDUSTRY_BY_ID } from "../../packages/core/src/index";
import { SYSTEMS, universe, universeMarkdown } from "./lib/universe";
import type { Resolved, Seed } from "./resolve";

const here = dirname(fileURLToPath(import.meta.url));
const dataArg = process.argv.indexOf("--data");
const DATA = resolve(dataArg > 0 ? process.argv[dataArg + 1]! : join(here, "..", "..", "data"));
const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

const seeds = readJson<{ companies: Seed[] }>(join(here, "seeds", "industries.json"), { companies: [] }).companies;
const resolvedList = readJson<{ generated_at?: string; companies: Resolved[] }>(join(here, "out", "resolved.json"), { companies: [] });
const resolved = new Map(resolvedList.companies.map((r) => [r.name, r]));
const dirList = readJson<{ companies: { key: string; name: string; ats: string; status: string; open_jobs: number | null }[] }>(join(DATA, "catalog", "directory.json"), { companies: [] }).companies;
const directory = new Map(dirList.map((c) => [c.key, c]));
/** Same rule as publish.ts: exactly one live directory company with the seed's name. */
const byExactName = (name: string) => {
  const same = dirList.filter((c) => c.status === "live" && c.name.toLowerCase() === name.toLowerCase());
  return same.length === 1 ? same[0] : undefined;
};
const supported = new Set(Object.keys(connectors));

type Row = { seed: Seed; outcome: "trackable" | "not scannable" | "custom site" | "not found" | "unreachable"; ats?: string; detail: string };
const rows: Row[] = seeds.map((seed) => {
  const r = resolved.get(seed.name);
  const known = seed.careers_url ? detectCompany(seed.careers_url) : null;
  const board = known ? { ats: known.ats, key: companyKey(known), supported: known.supported } : r?.board;
  if (board) {
    const d = directory.get(board.key);
    if (board.supported)
      return { seed, outcome: "trackable", ats: board.ats, detail: d ? `${d.status}${d.open_jobs ? `, ${d.open_jobs} jobs` : ""}` : "found, not in directory yet (run catalog:refresh)" };
    return { seed, outcome: "not scannable", ats: board.ats, detail: board.key };
  }
  const named = byExactName(seed.name);
  if (named && supported.has(named.ats)) return { seed, outcome: "trackable", ats: named.ats, detail: `${named.key} (matched by name)` };
  if (!r) return { seed, outcome: "not found", detail: "not resolved yet (run catalog:resolve)" };
  if (r.status === "custom") return { seed, outcome: "custom site", ats: r.hints?.[0], detail: `${r.careers_url}${r.hints?.length ? ` (mentions ${r.hints.join(", ")})` : ""}` };
  if (r.status === "error") return { seed, outcome: "unreachable", detail: r.error ?? "error" };
  return { seed, outcome: "not found", detail: "no careers page found" };
});

// ---- universe ----
const mergedFile = readJson<{ restricted_only?: Record<string, number>; boards: { key: string; ats: string; families: string[] }[] }>(join(here, "out", "merged.json"), { boards: [] });
const bulk = readJson<{ companies: Resolved[] }>(join(here, "out", "resolved-bulk.json"), { companies: [] }).companies;
const tracked = new Set<string>(SYSTEMS);
const universeLines = universeMarkdown(
  universe({
    boards: mergedFile.boards,
    status: new Map(dirList.map((c) => [c.key, c.status])),
    // Workday counts: the directory lists it though the app has no connector for it yet.
    sample: bulk.flatMap((r) => (r.board && tracked.has(r.board.ats) ? [companyKey(r.board)] : [])),
    restrictedOnly: mergedFile.restricted_only ?? {},
  }),
);
const sampleNote = `Independent sample: ${bulk.length.toLocaleString()} Wikidata companies resolved, ${bulk.filter((r) => r.board && tracked.has(r.board.ats)).length} on a system the directory tracks, ${bulk.filter((r) => r.board && !tracked.has(r.board.ats)).length} on another system, ${bulk.filter((r) => r.status === "custom").length} with a careers page we can't read.`;

const OUTCOMES = ["trackable", "not scannable", "custom site", "not found", "unreachable"] as const;
const industries = [...new Set(seeds.flatMap((s) => s.industries))].sort((a, b) => rows.filter((r) => r.seed.industries.includes(b)).length - rows.filter((r) => r.seed.industries.includes(a)).length);

const lines: string[] = [
  "# Directory coverage",
  "",
  sampleNote,
  "",
  ...universeLines,
  "# Coverage of must-have companies",
  "",
  `Seed list: ${seeds.length} companies (scripts/catalog/seeds/industries.json). Resolved ${resolvedList.generated_at?.slice(0, 10) ?? "never"}.`,
  "",
  "**Trackable** = on a hiring system we scan today. **Not scannable** = board found on a system we don't scan yet. **Custom site** = careers page with no board we can read (hint: which system its pages mention).",
  "",
  "## By industry",
  "",
  `| Industry | Seeds | ${OUTCOMES.join(" | ")} | Trackable % |`,
  `|---|---|${OUTCOMES.map(() => "---").join("|")}|---|`,
];
for (const id of industries) {
  const rs = rows.filter((r) => r.seed.industries.includes(id));
  const n = (o: string) => rs.filter((r) => r.outcome === o).length;
  lines.push(`| ${INDUSTRY_BY_ID.get(id)?.label ?? id} | ${rs.length} | ${OUTCOMES.map(n).join(" | ")} | ${Math.round((n("trackable") / rs.length) * 100)}% |`);
}
const all = (o: string) => rows.filter((r) => r.outcome === o).length;
lines.push(`| **All** | ${rows.length} | ${OUTCOMES.map(all).join(" | ")} | ${Math.round((all("trackable") / rows.length) * 100)}% |`, "");

// Which connector unlocks the most seeds: boards on that system, plus custom sites that mention it.
const unlock = new Map<string, { boards: string[]; hinted: string[] }>();
for (const r of rows) {
  if (r.outcome === "not scannable" && r.ats) {
    if (!unlock.has(r.ats)) unlock.set(r.ats, { boards: [], hinted: [] });
    unlock.get(r.ats)!.boards.push(r.seed.name);
  }
  if (r.outcome === "custom site") {
    for (const h of resolved.get(r.seed.name)?.hints ?? []) {
      if (supported.has(h)) continue;
      if (!unlock.has(h)) unlock.set(h, { boards: [], hinted: [] });
      unlock.get(h)!.hinted.push(r.seed.name);
    }
  }
}
// Beyond the seeds, the directory may already hold many companies on the same system.
const inDirectory = (ats: string) => dirList.filter((c) => c.ats === ats && c.status !== "dead").length;
lines.push(
  "## Next connectors (by seed companies they would unlock)",
  "",
  "| Hiring system | Seed boards found | Seed sites mentioning it | Directory companies on it | Seed companies |",
  "|---|---|---|---|---|",
);
for (const [ats, u] of [...unlock].sort((a, b) => b[1].boards.length + b[1].hinted.length - (a[1].boards.length + a[1].hinted.length) || inDirectory(b[0]) - inDirectory(a[0]))) {
  lines.push(`| ${ats} | ${u.boards.length} | ${u.hinted.length} | ${inDirectory(ats).toLocaleString()} | ${[...u.boards, ...u.hinted.map((h) => `${h}?`)].slice(0, 14).join(", ")} |`);
}
lines.push("", "## Not trackable yet", "", "| Company | Industries | Outcome | Detail |", "|---|---|---|---|");
for (const r of rows.filter((x) => x.outcome !== "trackable").sort((a, b) => a.outcome.localeCompare(b.outcome) || a.seed.name.localeCompare(b.seed.name))) {
  lines.push(`| ${r.seed.name} | ${r.seed.industries.join(", ")} | ${r.outcome}${r.ats ? ` (${r.ats})` : ""} | ${r.detail.replace(/\|/g, "/")} |`);
}
writeFileSync(join(here, "out", "coverage.md"), `${lines.join("\n")}\n`);
console.log(lines.slice(0, 16 + universeLines.length + industries.length).join("\n"));
console.log(`\nWrote ${join(here, "out", "coverage.md")}`);
