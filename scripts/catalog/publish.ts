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
 * list, Wikidata and its own job titles (lib/tags.ts); `tag_src` says which tags didn't come from a
 * list, and out/tags.json records every source of every tag.
 *
 *   pnpm exec tsx scripts/catalog/publish.ts [--data <dir>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  jobCompanyKey,
  type IndexedCompany,
  type IndexRow,
} from "@rawjobs/core";
import type { Resolved, Seed } from "./resolve";
import type { BulkSeed } from "./seeds-bulk";
import { type DirectoryMove, dirKeyOf } from "./lib/moves";
import { catalogDir, dataDir } from "./lib/paths";
import { matchVisa, type RegisterFile } from "./lib/visa";
import { readCheckTitles, readFeedTitles, TagBook, TITLES_SOURCE, WIKIDATA_SOURCE } from "./lib/tags";
import { boardMatchesWebsite, industriesForWikidata, plainName } from "./lib/wikidata";

const dataArg = process.argv.indexOf("--data");
const DATA = resolve(dataArg > 0 ? process.argv[dataArg + 1]! : dataDir);
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
const built = readJson<{ companies: Dir[]; moves?: DirectoryMove[] }>(join(catalogDir, "out", "directory.json"), { companies: [] });
const dir = built.companies.filter((d) => !isPlaceholderBoard(d.name));
/** Accepted moves (build.ts): passed on to apps, and their old boards stay out from every source. */
const moves = built.moves ?? [];
const movedAway = new Set(moves.flatMap((m) => dirKeyOf(m.from) ?? []));
const byKey = new Map(dir.map((d) => [d.key, d]));

// ---- job rows ----
// Latest successful index line per company wins.
const index = new Map<string, { fetched_at: string; open_jobs: number; rows: IndexRow[] }>();
for (const f of readdirSync(join(catalogDir, "out")).filter((n) => /^index-.+\.jsonl$/.test(n))) {
  for (const line of readFileSync(join(catalogDir, "out", f), "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { key: string; fetched_at: string; open_jobs?: number; rows?: IndexRow[]; error?: string };
    if (r.error || !r.rows) continue;
    const prev = index.get(r.key);
    if (!prev || prev.fetched_at < r.fetched_at) index.set(r.key, { fetched_at: r.fetched_at, open_jobs: r.open_jobs ?? r.rows.length, rows: r.rows });
  }
}

// ---- industry tags: key -> industry id -> sources (lib/tags.ts) ----
const book = new TagBook();
const tag = (key: string, ids: readonly string[], source: string) => book.add(key, ids, source);
// 1. Source lists' own labels.
const cryptoJobs = readJson<{ companies: { jobs_url: string; category?: string }[] }>(join(catalogDir, "seeds", "crypto-jobs-fyi.companies.json"), { companies: [] });
for (const c of cryptoJobs.companies) {
  const found = detectCompany(c.jobs_url);
  if (found) tag(companyKey(found), industriesForLabel(c.category), "crypto-jobs list");
}
const curated = readJson<{ companies: { key: string; segment?: string }[] }>(join(catalogDir, "seeds", "curated-boards.json"), { companies: [] });
for (const c of curated.companies) tag(c.key, industriesForLabel(c.segment), "curated list");
// 2. The seed list, through the boards found for each seed.
const seeds = readJson<{ companies: Seed[] }>(join(catalogDir, "seeds", "industries.json"), { companies: [] }).companies;
const resolved = readJson<{ companies: Resolved[] }>(join(catalogDir, "out", "resolved.json"), { companies: [] }).companies;
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
// 3. Wikidata (CC0): the companies seeds-bulk.ts reads, with their industries (lib/wikidata.ts). Matched
// by the board resolve.ts --bulk found on the company's own website, or by the same name (one Wikidata
// company has it) and a board named like its website ("visa" for visa.com).
const wikidata = readJson<{ companies: BulkSeed[] }>(join(catalogDir, "raw", "wikidata", "companies.json"), { companies: [] }).companies;
const wikidataByName = new Map<string, BulkSeed[]>();
for (const w of wikidata) {
  const n = plainName(w.name);
  if (n) wikidataByName.set(n, [...(wikidataByName.get(n) ?? []), w]);
}
const wikidataIds = (w: BulkSeed | undefined) => (w?.industry_items?.length ? industriesForWikidata(w.industry_items) : []);
const bulkSeeds = new Map(wikidata.map((w) => [w.name, w]));
for (const r of readJson<{ companies: Resolved[] }>(join(catalogDir, "out", "resolved-bulk.json"), { companies: [] }).companies) {
  if (r.board) tag(r.board.key, wikidataIds(bulkSeeds.get(r.name)), WIKIDATA_SOURCE);
}
for (const d of dir) {
  const same = wikidataByName.get(plainName(d.name));
  if (same?.length === 1 && boardMatchesWebsite(d, same[0]!.website)) tag(d.key, wikidataIds(same[0]), WIKIDATA_SOURCE);
}
// 4. Job titles (needs the industries already known, for "requires"). From the job index; for the
// companies it doesn't read (Workday, or not reached this week), from the shared job feed (downloaded
// into out/feed by the workflows); else from the titles a live check read on the way (out/titles.jsonl).
const feedTitles = readFeedTitles(join(catalogDir, "out", "feed"));
const checkTitles = readCheckTitles(join(catalogDir, "out"));
const titleCounts = { index: 0, feed: 0, checks: 0 };
for (const d of dir) {
  const from: [keyof typeof titleCounts, string[] | undefined][] = [
    ["index", index.get(d.key)?.rows.map((r) => r[0])],
    ["feed", feedTitles.get(jobCompanyKey(d))],
    ["checks", checkTitles.get(d.key)],
  ];
  const found = from.find(([, titles]) => titles?.length);
  if (!found) continue;
  titleCounts[found[0]]++;
  tag(d.key, industriesFromTitles(found[1]!, book.known(d.key)), TITLES_SOURCE);
}
/** The seed list's hand-written name beats one from a source list or the board's address ("Saxobank" -> "Saxo Bank"). */
const nameOf = (d: Dir) => seedBoards.get(d.key)?.name || d.name;
/** `tags` (lists, Wikidata), `title_tags` (job titles only) and `tag_src`: see TagBook.tagsOf. */
const tagsOf = (key: string) => book.tagsOf(key);

// ---- user additions (Add by link) ----
const additions = readJson<{ companies: Addition[] }>(join(OUT, "additions.json"), { companies: [] }).companies.filter((a) => !byKey.has(a.key) && !movedAway.has(a.key));

// ---- seed companies on hiring systems we can't scan yet ----
const supported = new Set(Object.keys(connectors));
const known = new Set([...byKey.keys(), ...additions.map((a) => a.key)]);
const unverified = resolved
  .filter((r) => r.board && !r.board.supported && !known.has(r.board.key) && !movedAway.has(r.board.key))
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
    ...(d.shard ? { shard: d.shard } : {}),
    ...(d.site ? { site: d.site } : {}),
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
    ...(d.shard ? { shard: d.shard } : {}),
    ...(d.site ? { site: d.site } : {}),
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

// ---- visa sponsors: companies on a government register of visa sponsors (visa.ts downloads them) ----
// `visa` is new in directory.json and index.json: { GB: "2026-10-13", US: "FY2026" }. Older apps ignore it.
const visaDir = join(catalogDir, "raw", "visa");
const registers = existsSync(visaDir)
  ? readdirSync(visaDir)
      .filter((f) => /^[A-Z]{2}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(visaDir, f), "utf8")) as RegisterFile)
  : [];
const sponsors = matchVisa(slim, registers);
for (const c of slim as { key: string; visa?: unknown }[]) {
  const v = sponsors.visa.get(c.key);
  if (v) c.visa = v;
}
for (const c of indexed) {
  const v = sponsors.visa.get(c.key);
  if (v) c.visa = v;
}

/** Live companies we can scan per industry (list or title tags): the pickers flag industries with few. */
const industries = industryCounts(slim.filter((c) => c.status === "live" && supported.has(c.ats)));

mkdirSync(OUT, { recursive: true });
const generated_at = new Date().toISOString();
// `moves` is new in directory.json: older apps read only `companies` (and `industries`) and ignore it.
writeFileSync(join(OUT, "directory.json"), JSON.stringify({ generated_at, count: slim.length, industries, companies: slim, moves }));
writeFileSync(join(OUT, "index.json"), JSON.stringify({ generated_at, count: indexed.length, companies: indexed }));
writeFileSync(join(catalogDir, "out", "tags.json"), JSON.stringify(book, null, 1));

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
console.log(
  registers.length
    ? `Visa sponsors: ${sponsors.stats.map((s) => `${s.country} ${s.matched} (list ${s.period}; ${s.skippedAmbiguous} names shared by several companies and ${s.skippedCommon} common ones skipped)`).join(", ")}.`
    : "Visa sponsors: no registers downloaded (pnpm catalog:visa), so no company is tagged.",
);
{
  // Live companies by the surest source of any of their tags, and where the job titles came from.
  const live = slim.filter((c) => c.status === "live");
  const best = (c: (typeof slim)[number]) => (!c.tags?.length && !c.title_tags?.length ? "none" : (c.tags ?? []).some((t) => !c.tag_src?.[t]) ? "list" : c.tags?.length ? "wikidata" : "titles");
  const bySource: Record<string, number> = { list: 0, wikidata: 0, titles: 0, none: 0 };
  for (const c of live) bySource[best(c)]!++;
  console.log(
    `Live companies with an industry: ${live.length - bySource.none!} of ${live.length} (best source: ${bySource.list} list, ${bySource.wikidata} Wikidata, ${bySource.titles} job titles). Job titles read from: ${titleCounts.index} index, ${titleCounts.feed} job feed, ${titleCounts.checks} live checks.`,
  );
}
const sparse = INDUSTRIES.filter((i) => (industries[i.id] ?? 0) < FEW_COMPANIES).map((i) => `${i.id} (${industries[i.id] ?? 0})`);
if (sparse.length) console.log(`Few live companies to scan (under ${FEW_COMPANIES}): ${sparse.join(", ")}`);
