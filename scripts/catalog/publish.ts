/**
 * Publish the catalogue into the app's data folder:
 *   data/catalog/directory.json  slim list of every live/dormant company (search & browse)
 *   data/catalog/index.json      open-job rows per indexed company (suggestions)
 *
 * Also merged in:
 *   - companies the user found with "Add by link" (data/catalog/additions.json)
 *   - seed companies on hiring systems we can't scan yet (from out/resolved.json), as "unverified",
 *     so they can be watched as "coming soon"
 * Every company gets industry tags (ids from catalog/industries.ts) from the source lists, the seed
 * list and its own job titles; out/tags.json records where each tag came from.
 *
 *   pnpm exec tsx scripts/catalog/publish.ts [--data <dir>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  careersUrl,
  companyKey,
  connectors,
  detectCompany,
  FEW_COMPANIES,
  INDUSTRIES,
  industriesForLabel,
  industryCounts,
  industriesFromTitles,
  isPlaceholderBoard,
  type IndexedCompany,
  type IndexRow,
} from "../../packages/core/src/index";
import type { Resolved, Seed } from "./resolve";

const here = dirname(fileURLToPath(import.meta.url));
const dataArg = process.argv.indexOf("--data");
const DATA = resolve(dataArg > 0 ? process.argv[dataArg + 1]! : join(here, "..", "..", "data"));
const OUT = join(DATA, "catalog");

type Dir = {
  key: string;
  name: string;
  name_source: string;
  ats: string;
  slug: string;
  region?: string;
  shard?: string;
  site?: string;
  careers_url: string;
  tier: "curated" | "dump";
  agreeing_sources: number;
  status: string;
  open_jobs: number | null;
};
type Addition = Pick<Dir, "key" | "name" | "ats" | "slug" | "region" | "shard" | "site" | "careers_url" | "status" | "open_jobs"> & { added_at: string };

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

// Sandbox/training/test boards stay out (build.ts drops them too; this covers older builds).
const dir = readJson<{ companies: Dir[] }>(join(here, "out", "directory.json"), { companies: [] }).companies.filter((d) => !isPlaceholderBoard(d.name));
const byKey = new Map(dir.map((d) => [d.key, d]));

// ---- job rows ----
// Latest successful index line per company wins.
const index = new Map<string, { fetched_at: string; open_jobs: number; rows: IndexRow[] }>();
for (const f of readdirSync(join(here, "out")).filter((n) => /^index-.+\.jsonl$/.test(n))) {
  for (const line of readFileSync(join(here, "out", f), "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { key: string; fetched_at: string; open_jobs?: number; rows?: IndexRow[]; error?: string };
    if (r.error || !r.rows) continue;
    const prev = index.get(r.key);
    if (!prev || prev.fetched_at < r.fetched_at) index.set(r.key, { fetched_at: r.fetched_at, open_jobs: r.open_jobs ?? r.rows.length, rows: r.rows });
  }
}

// ---- industry tags: key -> industry id -> sources ----
const tags = new Map<string, Map<string, Set<string>>>();
const tag = (key: string, ids: readonly string[], source: string) => {
  for (const id of ids) {
    if (!tags.has(key)) tags.set(key, new Map());
    const m = tags.get(key)!;
    if (!m.has(id)) m.set(id, new Set());
    m.get(id)!.add(source);
  }
};
// 1. Source lists' own labels.
const cryptoJobs = readJson<{ companies: { jobs_url: string; category?: string }[] }>(join(here, "..", "curate", "sources", "crypto-jobs-fyi.companies.json"), { companies: [] });
for (const c of cryptoJobs.companies) {
  const found = detectCompany(c.jobs_url);
  if (found) tag(companyKey(found), industriesForLabel(c.category), "crypto-jobs list");
}
const curated = readJson<{ companies: { key: string; segment?: string }[] }>(join(here, "seeds", "curated-boards.json"), { companies: [] });
for (const c of curated.companies) tag(c.key, industriesForLabel(c.segment), "curated list");
// 2. The seed list, through the boards found for each seed.
const seeds = readJson<{ companies: Seed[] }>(join(here, "seeds", "industries.json"), { companies: [] }).companies;
const resolved = readJson<{ companies: Resolved[] }>(join(here, "out", "resolved.json"), { companies: [] }).companies;
const seedBoards = new Map<string, Seed>();
for (const s of seeds) {
  const found = s.careers_url ? detectCompany(s.careers_url) : null;
  if (found) seedBoards.set(companyKey(found), s);
}
for (const r of resolved) {
  const s = seeds.find((x) => x.name === r.name);
  if (r.board && s) seedBoards.set(r.board.key, s);
}
// Seeds whose site we couldn't read (bot checks, own careers apps): match the directory by exact name,
// when exactly one live company has it.
const linked = new Set(seedBoards.values());
const byName = new Map<string, Dir[]>();
for (const d of dir) byName.set(d.name.toLowerCase(), [...(byName.get(d.name.toLowerCase()) ?? []), d]);
for (const s of seeds) {
  if (linked.has(s)) continue;
  const same = (byName.get(s.name.toLowerCase()) ?? []).filter((d) => d.status === "live");
  if (same.length === 1) seedBoards.set(same[0]!.key, s);
}
for (const [key, s] of seedBoards) tag(key, s.industries, "seed list");
// 3. Job titles (needs the industries already known, for "requires").
for (const [key, v] of index) {
  const known = [...(tags.get(key)?.keys() ?? [])];
  tag(key, industriesFromTitles(v.rows.map((r) => r[0]), known), "job titles");
}
/** The seed list's hand-written name beats one from a source list or the board's address ("Saxobank" -> "Saxo Bank"). */
const nameOf = (d: Dir) => seedBoards.get(d.key)?.name || d.name;
/**
 * `tags`: industries a list or the seed list puts the company in. `title_tags`: industries only its job
 * titles point to. Titles say what a company hires for, not what it is: Anthropic's say "Inference", not
 * "AI", while a label with an AI product team has "AI" in many titles. So the two are kept apart.
 */
const tagsOf = (key: string) => {
  const m = tags.get(key);
  if (!m) return {};
  const fromLists = [...m].filter(([, src]) => [...src].some((s) => s !== "job titles")).map(([id]) => id);
  const fromTitles = [...m].filter(([, src]) => [...src].every((s) => s === "job titles")).map(([id]) => id);
  return {
    ...(fromLists.length ? { tags: fromLists.sort() } : {}),
    ...(fromTitles.length ? { title_tags: fromTitles.sort() } : {}),
  };
};

// ---- user additions (Add by link) ----
const additions = readJson<{ companies: Addition[] }>(join(OUT, "additions.json"), { companies: [] }).companies.filter((a) => !byKey.has(a.key));

// ---- seed companies on hiring systems we can't scan yet ----
const supported = new Set(Object.keys(connectors));
const known = new Set([...byKey.keys(), ...additions.map((a) => a.key)]);
const unverified = resolved
  .filter((r) => r.board && !r.board.supported && !known.has(r.board.key))
  .map((r) => {
    const b = r.board!;
    return {
      key: b.key,
      name: r.name,
      ats: b.ats,
      slug: b.slug,
      ...(b.region ? { region: b.region } : {}),
      ...(b.shard ? { shard: b.shard } : {}),
      ...(b.site ? { site: b.site } : {}),
      careers_url: careersUrl(b) || r.careers_url || r.evidence || `https://${r.website}`,
      tier: "curated" as const,
      status: "unverified",
      open_jobs: null,
      indexed: false,
      origin: "seed" as const,
      ...tagsOf(b.key),
    };
  });

const indexed: IndexedCompany[] = [];
for (const [key, v] of index) {
  const d = byKey.get(key);
  if (!d) continue;
  indexed.push({
    key,
    name: nameOf(d),
    ats: d.ats,
    slug: d.slug,
    ...(d.region ? { region: d.region } : {}),
    ...(d.shard ? { shard: d.shard } : {}), ...(d.site ? { site: d.site } : {}),
    careers_url: d.careers_url,
    open_jobs: v.open_jobs,
    // Row ages count from this fetch, which can be up to a week older than the index itself.
    fetched_at: v.fetched_at,
    rows: v.rows,
    // Seed companies count as hand-reviewed, like the curated list.
    tier: seedBoards.has(key) ? "curated" : d.tier,
    ...tagsOf(key),
  });
}

const slim = [
  ...dir.map((d) => ({
    key: d.key,
    name: nameOf(d),
    ats: d.ats,
    slug: d.slug,
    ...(d.region ? { region: d.region } : {}),
    ...(d.shard ? { shard: d.shard } : {}), ...(d.site ? { site: d.site } : {}),
    careers_url: d.careers_url,
    tier: seedBoards.has(d.key) ? ("curated" as const) : d.tier,
    status: d.status,
    open_jobs: index.get(d.key)?.open_jobs ?? d.open_jobs,
    indexed: index.has(d.key),
    ...tagsOf(d.key),
  })),
  ...additions.map((a) => ({ ...a, tier: "dump" as const, indexed: false, origin: "user" as const, ...tagsOf(a.key) })),
  ...unverified,
];

/** Live companies we can scan per industry (list or title tags): the pickers flag industries with few. */
const industries = industryCounts(slim.filter((c) => c.status === "live" && supported.has(c.ats)));

mkdirSync(OUT, { recursive: true });
const generated_at = new Date().toISOString();
writeFileSync(join(OUT, "directory.json"), JSON.stringify({ generated_at, count: slim.length, industries, companies: slim }));
writeFileSync(join(OUT, "index.json"), JSON.stringify({ generated_at, count: indexed.length, companies: indexed }));
writeFileSync(
  join(here, "out", "tags.json"),
  JSON.stringify(Object.fromEntries([...tags].map(([k, m]) => [k, Object.fromEntries([...m].map(([id, src]) => [id, [...src]]))])), null, 1),
);

const perIndustry = INDUSTRIES.map((i) => {
  const n = slim.filter((c) => c.tags?.includes(i.id)).length;
  const scannable = slim.filter((c) => c.tags?.includes(i.id) && supported.has(c.ats)).length;
  const hiring = slim.filter((c) => c.title_tags?.includes(i.id)).length;
  return `${i.id} ${n} (${scannable} scannable) + ${hiring} from job titles only`;
});
console.log(
  `Published to ${OUT}: directory ${slim.length} companies (${additions.length} added by you, ${unverified.length} seed companies not scannable yet), index ${indexed.length} companies (${indexed.reduce((s, c) => s + c.rows.length, 0)} job rows).`,
);
console.log(
  `Tagged ${slim.filter((c) => c.tags?.length).length} companies by industry (+${slim.filter((c) => !c.tags?.length && c.title_tags?.length).length} from job titles only):\n  ${perIndustry.join("\n  ")}`,
);
const sparse = INDUSTRIES.filter((i) => (industries[i.id] ?? 0) < FEW_COMPANIES).map((i) => `${i.id} (${industries[i.id] ?? 0})`);
if (sparse.length) console.log(`Few live companies to scan (under ${FEW_COMPANIES}): ${sparse.join(", ")}`);
