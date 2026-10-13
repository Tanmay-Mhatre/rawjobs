/**
 * A broad, company-first seed list from Wikidata (CC0): companies with an official website that
 * have 50+ employees or are listed on a stock exchange, and aren't dissolved. resolve.ts --bulk
 * then finds each one's hiring system from its website. This is how we find boards that no crawl
 * has linked, and it doubles as an independent sample to measure coverage (coverage.ts).
 * Each company also keeps its Wikidata industries (P452), which publish.ts turns into industry tags.
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
/** The same companies' industries (P452): item pairs only, no labels, so each query takes seconds. */
const INDUSTRY_QUERIES = {
  employees: `SELECT DISTINCT ?item ?ind WHERE { VALUES ?type { ${TYPES} } ?item wdt:P31 ?type ; wdt:P1128 ?e ; wdt:P452 ?ind . FILTER(?e >= 50) }`,
  listed: `SELECT DISTINCT ?item ?ind WHERE { ?item wdt:P414 ?exchange ; wdt:P452 ?ind . }`,
};

type Row = { item: { value: string }; label?: { value: string }; site: { value: string }; cc?: { value: string }; emp?: { value: string } };
/** `industry_items`: its Wikidata industry items (Q-ids); publish.ts maps them to our ids (lib/wikidata.ts). */
export type BulkSeed = Seed & { wikidata: string; country?: string; employees?: number; industry_items?: string[] };

const qid = (uri: string) => uri.replace(/^.*\//, "");

async function sparql<T>(query: string): Promise<T[]> {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`;
  const res = await http.request(url, { headers: { accept: "application/sparql-results+json" } });
  return ((await res.json()) as { results: { bindings: T[] } }).results.bindings;
}

/** Industry items per company. A failed query only costs the industries (said so), not the company list. */
async function industryItems(): Promise<Map<string, Set<string>>> {
  const items = new Map<string, Set<string>>();
  for (const [name, query] of Object.entries(INDUSTRY_QUERIES)) {
    try {
      const rows = await sparql<{ item: { value: string }; ind: { value: string } }>(query);
      for (const r of rows) {
        const id = qid(r.item.value);
        if (!items.has(id)) items.set(id, new Set());
        items.get(id)!.add(qid(r.ind.value));
      }
      console.error(`  industries (${name}): ${rows.length} rows`);
    } catch (err) {
      console.error(`! industries (${name}) failed: ${(err as Error).message}`);
      if (process.env.GITHUB_ACTIONS)
        console.log(`::warning title=Wikidata industries::The ${name} industry query failed (${(err as Error).message}); those companies get no Wikidata industry this week.`);
    }
  }
  return items;
}

/** One website per company: prefer https, then the shortest (the homepage over a deep link). */
function better(a: string, b: string): string {
  const score = (u: string) => (u.startsWith("https://") ? 0 : 1000) + u.length;
  return score(b) < score(a) ? b : a;
}

async function main() {
  const seeds = new Map<string, BulkSeed>();
  for (const [name, query] of Object.entries(QUERIES)) {
    const rows = await sparql<Row>(query);
    for (const r of rows) {
      const id = qid(r.item.value);
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
  const industries = await industryItems();
  for (const s of seeds.values()) {
    const items = industries.get(s.wikidata);
    if (items?.size) s.industry_items = [...items].sort();
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
