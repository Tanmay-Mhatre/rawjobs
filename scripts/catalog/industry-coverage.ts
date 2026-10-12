/**
 * How well the industry catalog tags the job index: per industry, how many companies their job
 * titles tag, with a few examples to eyeball, and which industries come up short.
 *
 *   pnpm exec tsx scripts/catalog/industry-coverage.ts [--samples 8] [--min 25] [--only <id> (also lists the matching titles)]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRIES, INDUSTRY_BY_ID, industriesFromTitles } from "../../packages/core/src/index";
import { matchesAny } from "../../packages/core/src/text";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const samples = Number(arg("samples", "8"));
const min = Number(arg("min", "25"));
const only = arg("only", "");

const out = join(here, "out");
const names = new Map<string, string>();
if (existsSync(join(out, "directory.json"))) {
  for (const d of (JSON.parse(readFileSync(join(out, "directory.json"), "utf8")) as { companies: { key: string; name: string }[] }).companies) names.set(d.key, d.name);
}
// Latest successful index line per company, as publish.ts reads it.
const index = new Map<string, { fetched_at: string; titles: string[] }>();
for (const f of readdirSync(out).filter((n) => /^index-.+\.jsonl$/.test(n))) {
  for (const line of readFileSync(join(out, f), "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { key: string; fetched_at: string; rows?: [string][]; error?: string };
    if (r.error || !r.rows) continue;
    const prev = index.get(r.key);
    if (!prev || prev.fetched_at < r.fetched_at) index.set(r.key, { fetched_at: r.fetched_at, titles: r.rows.map((row) => row[0]) });
  }
}

const byIndustry = new Map<string, string[]>(INDUSTRIES.map((i) => [i.id, []]));
for (const [key, { titles }] of index) for (const id of industriesFromTitles(titles)) byIndustry.get(id)?.push(key);

console.log(`${index.size} indexed companies\n`);
const short: string[] = [];
for (const ind of INDUSTRIES) {
  if (only && ind.id !== only) continue;
  const keys = byIndustry.get(ind.id)!;
  if (keys.length < min) short.push(`${ind.id} (${keys.length})`);
  const step = Math.max(1, Math.floor(keys.length / samples));
  const eg = keys
    .filter((_, i) => i % step === 0)
    .slice(0, samples)
    .map((k) => names.get(k) ?? k);
  console.log(`${ind.id.padEnd(16)} ${String(keys.length).padStart(5)}  ${eg.join(", ")}`);
  if (only) {
    const terms = [...ind.terms, ...(INDUSTRY_BY_ID.get(ind.id)!.titleTerms ?? [])];
    for (const k of keys.filter((_, i) => i % step === 0).slice(0, samples * 3))
      console.log(
        `  ${names.get(k) ?? k}: ${index
          .get(k)!
          .titles.filter((t) => matchesAny(t, terms))
          .slice(0, 3)
          .join(" | ")}`,
      );
  }
}
if (short.length) console.log(`\nUnder ${min} companies from job titles: ${short.join(", ")}`);
