/**
 * How precise the job-title industry tags are, per way of counting generic industry words in titles
 * (`GenericTitleTerms`: "all" = the old rule, "segment" = the one used, "strict", "none" = role
 * words only). Two ground truths: companies whose industry comes from a hand-made list (the seed
 * list, the curated list's segment, crypto-jobs-fyi's category: `tags` with no `tag_src`), and
 * Wikidata's industries (`tag_src` "wikidata"). Titles: the job index if given, else the job feed.
 *
 *   gh release download jobs -R <data repo> -D <tmp>/feed
 *   gh release download directory-YYYY-MM-DD -R <data repo> -p "directory.json*" -D <tmp>
 *   pnpm exec tsx scripts/catalog/industry-precision.ts --directory <tmp>/directory.json.gz --feed <tmp>/feed
 *     [--index scripts/catalog/out] [--modes all,segment,strict,none] [--mode segment] [--changed 30] [--only key1,key2]
 *
 * Precision: a title tag is right when the truth has it ("strict precision"), or has an industry
 * in the same group ("group precision": fintech vs payments, crypto vs crypto-exchange, healthtech
 * vs biotech). Lists name one or two industries, so a right but unlisted tag counts as wrong: read
 * the numbers comparatively. `--changed` lists companies whose tags change from "all" to `--mode`,
 * to judge by eye; `--only` prints the titles behind each old tag.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { INDUSTRY_BY_ID, industriesFromTitles, jobCompanyKey, type GenericTitleTerms } from "@rawjobs/core";
import { matchesAny } from "@rawjobs/core/text";
import { readFeedTitles } from "./lib/tags";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const dirPath = arg("directory");
if (!dirPath) throw new Error("--directory <directory.json[.gz]> is required");
const raw = readFileSync(dirPath);
type Company = { key: string; name: string; ats: string; slug: string; site?: string; tags?: string[]; tag_src?: Record<string, string> };
const companies = (JSON.parse((dirPath.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as { companies: Company[] }).companies;

// Titles: the job index's latest line per company, else the job feed (as publish.ts reads them).
const titles = new Map<string, string[]>();
const indexDir = arg("index");
if (indexDir && existsSync(indexDir)) {
  const at = new Map<string, string>();
  for (const f of readdirSync(indexDir).filter((n) => /^index-.+\.jsonl$/.test(n)))
    for (const line of readFileSync(join(indexDir, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as { key: string; fetched_at: string; rows?: [string][]; error?: string };
      if (r.error || !r.rows || (at.get(r.key) ?? "") > r.fetched_at) continue;
      at.set(r.key, r.fetched_at);
      titles.set(
        r.key,
        r.rows.map((row) => row[0]),
      );
    }
}
const feed = arg("feed") ? readFeedTitles(arg("feed")) : new Map<string, string[]>();
const titlesOf = (c: Company) => titles.get(c.key) ?? feed.get(jobCompanyKey(c));

const MODES = (arg("modes", "all,segment,strict,none").split(",") as GenericTitleTerms[]).filter(Boolean);
const mode = arg("mode", "segment") as GenericTitleTerms;
const group = (id: string) => INDUSTRY_BY_ID.get(id)?.group;
type Row = { c: Company; lists: string[]; wikidata: string[]; out: Record<string, string[]> };
const rows: Row[] = [];
for (const c of companies) {
  const t = titlesOf(c);
  if (!t?.length) continue;
  const known = c.tags ?? [];
  rows.push({
    c,
    lists: known.filter((id) => !c.tag_src?.[id]),
    wikidata: known.filter((id) => c.tag_src?.[id] === "wikidata"),
    out: Object.fromEntries(MODES.map((m) => [m, industriesFromTitles(t, known, m)])),
  });
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
console.log(`${companies.length} companies, ${rows.length} with titles\n`);
for (const truthOf of ["lists", "wikidata"] as const) {
  const truthRows = rows.filter((r) => r[truthOf].length);
  console.log(`Ground truth: ${truthOf} (${truthRows.length} companies with titles)`);
  console.log("rule   | title tags | strict precision | group precision | cos with >=1 tag | ...with a right one (group)");
  for (const m of MODES) {
    let tags = 0,
      strict = 0,
      loose = 0,
      covered = 0,
      coveredRight = 0;
    for (const r of truthRows) {
      const out = r.out[m]!;
      const truth = r[truthOf];
      tags += out.length;
      if (out.length) covered++;
      let right = false;
      for (const id of out) {
        if (truth.includes(id)) strict++;
        if (truth.some((t) => group(t) === group(id))) {
          loose++;
          right = true;
        }
      }
      if (right) coveredRight++;
    }
    console.log(
      `${m.padEnd(6)} | ${String(tags).padStart(10)} | ${pct(strict, tags).padStart(16)} | ${pct(loose, tags).padStart(15)} | ${`${covered} (${pct(covered, truthRows.length)})`.padStart(16)} | ${coveredRight}`,
    );
  }
  console.log("");
}
console.log("All companies with titles: rule | companies tagged | title tags");
for (const m of MODES) console.log(`  ${m.padEnd(6)} | ${rows.filter((r) => r.out[m]!.length).length} | ${rows.reduce((n, r) => n + r.out[m]!.length, 0)}`);

console.log(`\nper industry, companies tagged from titles: ${MODES.join(" -> ")}`);
for (const ind of INDUSTRY_BY_ID.values()) {
  const counts = MODES.map((m) => rows.filter((r) => r.out[m]!.includes(ind.id)).length);
  if (counts.some((n) => n)) console.log(`  ${ind.id.padEnd(16)} ${counts.join(" -> ")}`);
}

// Companies whose tags change under `--mode`, spread over the list, to eyeball.
const n = Number(arg("changed", "30"));
const changed = rows.filter((r) => r.out.all?.join() !== r.out[mode]?.join());
const step = Math.max(1, Math.floor(changed.length / n));
console.log(`\n${changed.length} companies change (all -> ${mode}); every ${step}th:`);
for (const r of changed.filter((_, i) => i % step === 0).slice(0, n)) {
  const known = [...r.lists.map((t) => `${t} (list)`), ...r.wikidata.map((t) => `${t} (wikidata)`)];
  console.log(`  ${r.c.name} (${r.c.key})${known.length ? ` [${known.join(", ")}]` : ""}: ${r.out.all?.join(", ") || "-"} -> ${r.out[mode]?.join(", ") || "-"}`);
}
// --only key1,key2: the titles behind each tag the old rule gives them.
for (const key of arg("only").split(",").filter(Boolean)) {
  const r = rows.find((x) => x.c.key === key);
  if (!r) continue;
  const t = titlesOf(r.c)!;
  console.log(`\n${r.c.name} (${key}), ${t.length} titles:`, JSON.stringify(r.out));
  for (const id of r.out.all ?? []) {
    const ind = INDUSTRY_BY_ID.get(id)!;
    const hits = t.filter((x) => matchesAny(x, [...ind.terms, ...(ind.titleTerms ?? [])]));
    console.log(`  ${id} (${hits.length}): ${[...new Set(hits)].slice(0, 12).join(" | ")}`);
  }
}
