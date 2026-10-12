/**
 * A broad, company-first seed list from Wikidata (CC0): companies with an official website that
 * have 50+ employees or are listed on a stock exchange, and aren't dissolved. resolve.ts --bulk
 * then finds each one's hiring system from its website. This is how we find boards that no crawl
 * has linked, and it doubles as an independent sample to measure coverage (coverage.ts).
 *
 * (yc-oss/api was considered and left out: it has no licence.)
 *
 *   pnpm catalog:seeds-bulk   -> scripts/catalog/raw/wikidata/companies.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient } from "@rawjobs/core";
import type { Seed } from "./resolve";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "raw", "wikidata", "companies.json");
const http = new HttpClient({ retries: 3, hostDelayMs: 5_000, timeoutMs: 120_000, backoffMs: 30_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; https://github.com/Tanmay-Mhatre)" });

/** Company-like classes (business, enterprise, public company, company, software company, corporation, organization-as-firm, startup). */
const TYPES = "wd:Q4830453 wd:Q6881511 wd:Q891723 wd:Q783794 wd:Q1058914 wd:Q167037 wd:Q210167 wd:Q18388277";
const COMMON = `
  ?item wdt:P856 ?site .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  FILTER NOT EXISTS { ?item wdt:P582 ?ended }
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item wdt:P17 ?country . ?country wdt:P297 ?cc }
  OPTIONAL { ?item wdt:P1128 ?emp }`;
const QUERIES = {
  employees: `SELECT ?item ?label ?site ?cc ?emp WHERE { VALUES ?type { ${TYPES} } ?item wdt:P31 ?type ; wdt:P1128 ?e . FILTER(?e >= 50) ${COMMON} }`,
  listed: `SELECT ?item ?label ?site ?cc ?emp WHERE { ?item wdt:P414 ?exchange . ${COMMON} }`,
};

type Row = { item: { value: string }; label?: { value: string }; site: { value: string }; cc?: { value: string }; emp?: { value: string } };
export type BulkSeed = Seed & { wikidata: string; country?: string; employees?: number };

/** One website per company: prefer https, then the shortest (the homepage over a deep link). */
function better(a: string, b: string): string {
  const score = (u: string) => (u.startsWith("https://") ? 0 : 1000) + u.length;
  return score(b) < score(a) ? b : a;
}

async function main() {
  const seeds = new Map<string, BulkSeed>();
  for (const [name, query] of Object.entries(QUERIES)) {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`;
    const res = await http.request(url, { headers: { accept: "application/sparql-results+json" } });
    const rows = ((await res.json()) as { results: { bindings: Row[] } }).results.bindings;
    for (const r of rows) {
      const id = r.item.value.replace(/^.*\//, "");
      const label = r.label?.value;
      const site = r.site.value;
      if (!label || !/^https?:\/\/[^/]+\.[a-z]{2,}/i.test(site)) continue;
      const prev = seeds.get(id);
      const employees = r.emp ? Math.round(Number(r.emp.value)) : undefined;
      if (prev) {
        prev.website = better(prev.website, site);
        if (employees && (!prev.employees || employees > prev.employees)) prev.employees = employees;
        continue;
      }
      seeds.set(id, { name: label, website: site, industries: [], wikidata: id, ...(r.cc ? { country: r.cc.value } : {}), ...(employees ? { employees } : {}) });
    }
    console.error(`  ${name}: ${rows.length} rows, ${seeds.size} companies so far`);
  }
  // resolve.ts keys results by name: keep one company per name (the bigger one).
  const byName = new Map<string, BulkSeed>();
  for (const s of seeds.values()) {
    const k = s.name.toLowerCase();
    const prev = byName.get(k);
    if (!prev || (s.employees ?? 0) > (prev.employees ?? 0)) byName.set(k, s);
  }
  const companies = [...byName.values()].sort((a, b) => (b.employees ?? 0) - (a.employees ?? 0));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), source: "Wikidata (CC0)", companies }));
  console.error(`Done: ${companies.length} companies -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
