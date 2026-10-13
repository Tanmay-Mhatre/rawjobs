/**
 * Merge every board source into one list keyed by (ats, board), and score how many
 * independent source families agree on each board. No network.
 *
 *   pnpm exec tsx scripts/catalog/merge.ts   -> scripts/catalog/out/merged.json
 *
 * Licences: only "publishable" sources may put a board into our list. Restricted sources
 * (share-alike / non-commercial) only add agreement votes to boards that are already in it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ATS_TYPES, companyKey, detectCompany, type AtsType } from "@rawjobs/core";
import { parse as parseYaml } from "yaml";
import { catalogDir, dataDir } from "./lib/paths";

const raw = (...p: string[]) => join(catalogDir, "raw", ...p);

type Ats = AtsType;
const TRACKED = new Set<string>(ATS_TYPES);

/** Sources that copy from the same place count as one family when we count agreement. */
const SOURCES = {
  ourcrawl: { family: "commoncrawl", publishable: true },
  // Our own pass over the Wayback Machine's URL index (wayback.ts).
  wayback: { family: "wayback", publishable: true },
  // Boards found by trying known company names on other hiring systems (crossprobe.ts).
  probe: { family: "probe", publishable: true },
  latmay: { family: "latmay", publishable: true },
  kalil: { family: "kalil", publishable: true },
  // amikai/openings-mcp companies.yaml lists (MIT, attribution in the directory repo's NOTICE.md).
  openingsmcp: { family: "openingsmcp", publishable: true },
  conors: { family: "openjobsdata", publishable: true },
  // LastRound AI ATS directory (CC BY 4.0, attribution in the directory repo's NOTICE.md).
  lastround: { family: "lastround", publishable: true },
  cryptojobs: { family: "cryptojobs", publishable: true },
  // Our own: the industry seed list and the boards resolve.ts found on those companies' websites.
  seeds: { family: "seeds", publishable: true },
  // Boards users added with "Add by link": the shared contributions list, and your own local additions.
  contrib: { family: "contributions", publishable: true },
  feashliaa: { family: "commoncrawl", publishable: false },
  // Votes carried inside upstreamit's slug store (CC BY-SA): cross-check only.
  "up:commoncrawl": { family: "commoncrawl", publishable: false },
  "up:feashliaa": { family: "commoncrawl", publishable: false },
  "up:hf-latmay": { family: "latmay", publishable: false },
  "up:kalil": { family: "kalil", publishable: false },
  "up:openjobsdata": { family: "openjobsdata", publishable: false },
  "up:cryptojobs": { family: "cryptojobs", publishable: false },
  "up:jobseek": { family: "jobseek", publishable: false },
  "up:openroles": { family: "openroles", publishable: false },
  "up:outscal": { family: "outscal", publishable: false },
  "up:wayback": { family: "wayback", publishable: false },
} as const;
type SourceId = keyof typeof SOURCES;

type Board = {
  key: string;
  ats: Ats;
  slug: string;
  region?: string;
  shard?: string;
  site?: string;
  name?: string;
  sources: Set<SourceId>;
};

const boards = new Map<string, Board>();
const keyOf = (ats: string, slug: string, shard?: string, site?: string) => companyKey({ ats, slug, shard, site });

function add(src: SourceId, b: { ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string }) {
  if (!TRACKED.has(b.ats) || !b.slug) return;
  if (b.ats === "workday" && (!b.shard || !b.site)) return;
  if ((b.ats === "taleo" && !b.site) || (b.ats === "oracle" && !b.shard)) return;
  const key = keyOf(b.ats, b.slug, b.shard, b.site);
  const prev = boards.get(key);
  if (prev) {
    prev.sources.add(src);
    if (!prev.name && b.name) prev.name = b.name;
    if (!prev.region && b.region) prev.region = b.region;
    if (!prev.site && b.site) prev.site = b.site;
    if (!prev.shard && b.shard) prev.shard = b.shard;
    return;
  }
  boards.set(key, { key, ats: b.ats as Ats, slug: b.slug, region: b.region, shard: b.shard, site: b.site, name: b.name, sources: new Set([src]) });
}

function fromUrl(src: SourceId, url: string, name?: string) {
  const d = detectCompany(url.trim());
  if (d) add(src, { ...d, name });
}

function csvRows(path: string): string[][] {
  // Small, simple CSVs (quoted fields possible in names).
  return readFileSync(path, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch === '"') q = !q;
        else if (ch === "," && !q) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      out.push(cur);
      return out;
    });
}

const counts: Record<string, number> = {};
const count = (src: string, n: number) => (counts[src] = (counts[src] ?? 0) + n);

/** Run `use` on a source file if it was downloaded (pnpm catalog:sources); skip it with a note if not. */
function withFile(path: string, use: (path: string) => void) {
  if (existsSync(path)) use(path);
  else console.error(`! ${path.slice(catalogDir.length + 1)} missing, skipped (run: pnpm catalog:sources)`);
}

// --- publishable sources ---
if (existsSync(raw("commoncrawl", "boards.json"))) {
  const cc = JSON.parse(readFileSync(raw("commoncrawl", "boards.json"), "utf8")) as { boards: { ats: string; slug: string; region?: string; shard?: string; site?: string }[] };
  for (const b of cc.boards) add("ourcrawl", b);
  count("ourcrawl", cc.boards.length);
} else console.error("! commoncrawl/boards.json missing (run commoncrawl.ts first)");
if (existsSync(raw("wayback", "boards.json"))) {
  const wb = JSON.parse(readFileSync(raw("wayback", "boards.json"), "utf8")) as { boards: { ats: string; slug: string; region?: string; shard?: string; site?: string }[] };
  for (const b of wb.boards) add("wayback", b);
  count("wayback", wb.boards.length);
} else console.error("! wayback/boards.json missing (run wayback.ts first)");
{
  // crossprobe.ts keeps every attempt; only live boards whose name matched are listed in found.
  const file = join(catalogDir, "out", "probe-found.json");
  const found = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { boards: { ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string }[] }).boards : [];
  for (const b of found) add("probe", b);
  count("probe", found.length);
}

withFile(raw("latmay", "ats_career_page_urls.csv"), (p) => {
  const rows = csvRows(p);
  for (const [url] of rows) if (url) fromUrl("latmay", url);
  count("latmay", rows.length);
});
for (const f of existsSync(raw("kalil0321")) ? readdirSync(raw("kalil0321")).filter((n) => n.endsWith(".csv")) : []) {
  const p = raw("kalil0321", f);
  const rows = csvRows(p);
  for (const [name, , url] of rows) if (url) fromUrl("kalil", url, name);
  count("kalil", rows.length);
}
{
  // openings-mcp: each provider's entry fields, turned into the careers URL our detection reads.
  const enc = encodeURIComponent;
  const toUrl: Record<string, (e: Record<string, string>) => string | undefined> = {
    ashby: (e) => e.board && `https://jobs.ashbyhq.com/${enc(e.board)}`,
    bamboohr: (e) => e.slug && `https://${e.slug}.bamboohr.com/careers`,
    greenhouse: (e) => e.board_token && `https://job-boards.greenhouse.io/${enc(e.board_token)}`,
    icims: (e) => e.host && `https://${e.host}/jobs`,
    lever: (e) => e.site && `https://jobs.lever.co/${enc(e.site)}`,
    oracle: (e) => e.host && e.site && `https://${e.host}/hcmUI/CandidateExperience/en/sites/${enc(e.site)}`,
    recruitee: (e) => e.slug && `https://${e.slug}.recruitee.com`,
    rippling: (e) => e.board_slug && `https://ats.rippling.com/${enc(e.board_slug)}/jobs`,
    smartrecruiters: (e) => e.company_identifier && `https://jobs.smartrecruiters.com/${enc(e.company_identifier)}`,
    teamtailor: (e) => e.host && `https://${e.host}`,
    workable: (e) => e.account && `https://apply.workable.com/${enc(e.account)}`,
    workday: (e) => e.tenant && e.instance && e.site && `https://${e.tenant}.${e.instance}.myworkdayjobs.com/${enc(e.site)}`,
  };
  for (const [provider, url] of Object.entries(toUrl)) {
    withFile(raw("openingsmcp", `${provider}.yaml`), (p) => {
      const list = parseYaml(readFileSync(p, "utf8")) as Record<string, string>[] | null;
      for (const e of list ?? []) {
        // Hosts and slugs come from a public list: only plain host names reach a URL.
        if (e.host && !/^[a-z0-9.-]+$/i.test(e.host)) continue;
        if (e.slug && !/^[a-z0-9_-]+$/i.test(e.slug)) continue;
        const u = url(e);
        if (u) fromUrl("openingsmcp", u, e.company);
      }
      count("openingsmcp", list?.length ?? 0);
    });
  }
}
withFile(raw("lastround", "ats-directory.csv"), (p) => {
  // Columns by header name: ats_vendor, company_name, board_slug, last_crawled.
  const header = readFileSync(p, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/, 1)[0]!
    .split(",")
    .map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [ats, name, slug] = [col("ats_vendor"), col("company_name"), col("board_slug")];
  if (ats < 0 || slug < 0) return console.error("! lastround/ats-directory.csv: unexpected columns, skipped");
  const rows = csvRows(p);
  for (const r of rows) add("lastround", { ats: (r[ats] ?? "").trim().toLowerCase(), slug: (r[slug] ?? "").trim(), name: name >= 0 ? r[name]?.trim() : undefined });
  count("lastround", rows.length);
});
withFile(raw("conorscode", "companies.json"), (p) => {
  const rows = JSON.parse(readFileSync(p, "utf8")) as { name: string; platform: string; slug?: string; workday?: { tenant: string; site: string; shard: string } }[];
  for (const r of rows) {
    if (r.platform === "workday" && r.workday) add("conors", { ats: "workday", slug: r.workday.tenant, shard: r.workday.shard, site: r.workday.site, name: r.name });
    else if (r.slug) add("conors", { ats: r.platform, slug: r.slug, name: r.name });
  }
  count("conors", rows.length);
});
{
  const rows = (JSON.parse(readFileSync(join(catalogDir, "seeds", "crypto-jobs-fyi.companies.json"), "utf8")) as { companies: { name: string; jobs_url: string }[] }).companies;
  for (const r of rows) fromUrl("cryptojobs", r.jobs_url, r.name);
  count("cryptojobs", rows.length);
}

{
  const seeds = (JSON.parse(readFileSync(join(catalogDir, "seeds", "industries.json"), "utf8")) as { companies: { name: string; careers_url?: string }[] }).companies;
  for (const s of seeds) if (s.careers_url) fromUrl("seeds", s.careers_url, s.name);
  // resolved.json: the industry seeds; resolved-bulk.json: the Wikidata companies (resolve.ts --bulk).
  for (const file of ["resolved.json", "resolved-bulk.json"]) {
    const path = join(catalogDir, "out", file);
    if (!existsSync(path)) continue;
    const resolved = (JSON.parse(readFileSync(path, "utf8")) as { companies: { name: string; board?: { ats: string; slug: string; region?: string; shard?: string; site?: string } }[] }).companies;
    for (const r of resolved) if (r.board) add("seeds", { ...r.board, name: r.name });
  }
  count("seeds", seeds.length);
}

{
  // Shared contributions (CONTRIBUTIONS_FILE, set by the directory workflow) and this install's own additions.
  type Contribution = { name?: string; ats: string; slug: string; region?: string; shard?: string; site?: string };
  const files = [process.env.CONTRIBUTIONS_FILE, join(dataDir, "catalog", "additions.json")].filter((f): f is string => !!f && existsSync(f));
  let n = 0;
  for (const f of files) {
    const list = (JSON.parse(readFileSync(f, "utf8")) as { companies: Contribution[] }).companies;
    for (const c of list) add("contrib", c);
    n += list.length;
  }
  count("contrib", n);
}

// --- restricted sources: votes only, never new boards ---
const publishableKeys = new Set([...boards.values()].filter((b) => [...b.sources].some((s) => SOURCES[s].publishable)).map((b) => b.key));
/** Boards only restricted sources list, per system: counted for coverage estimates, never published. */
const restrictedOnly = new Map<string, Set<string>>();
function vote(src: SourceId, ats: string, slug: string, shard?: string, site?: string) {
  const key = keyOf(ats, slug, shard, site);
  if (publishableKeys.has(key)) boards.get(key)!.sources.add(src);
  else {
    if (!restrictedOnly.has(ats)) restrictedOnly.set(ats, new Set());
    restrictedOnly.get(ats)!.add(key);
  }
}
for (const f of ["greenhouse", "lever", "ashby"]) {
  withFile(raw("feashliaa", `${f}_companies.json`), (p) => {
    const list = JSON.parse(readFileSync(p, "utf8")) as string[];
    for (const slug of list) vote("feashliaa", f, slug);
    count("feashliaa", list.length);
  });
}
withFile(raw("feashliaa", "workday_companies.json"), (p) => {
  const list = JSON.parse(readFileSync(p, "utf8")) as string[];
  for (const s of list) {
    const [tenant, shard, site] = s.split("|");
    if (tenant && shard && site) vote("feashliaa", "workday", tenant, shard, site);
  }
  count("feashliaa", list.length);
});
for (const f of ["greenhouse", "lever", "ashby", "workday"]) {
  const p = raw("upstreamit", `${f}.json`);
  if (!existsSync(p)) {
    console.error(`! upstreamit/${f}.json missing, skipped (run: pnpm catalog:sources)`);
    continue;
  }
  const j = JSON.parse(readFileSync(p, "utf8")) as { slugs: Record<string, { sources: string[] }> };
  for (const [slug, v] of Object.entries(j.slugs)) {
    for (const s of v.sources) {
      const id = `up:${s}` as SourceId;
      if (!(id in SOURCES)) continue;
      if (f === "workday") {
        const [tenant, shard, site] = slug.split("|");
        if (tenant && shard && site) vote(id, "workday", tenant, shard, site);
      } else vote(id, f, slug);
    }
  }
  count("upstreamit", Object.keys(j.slugs).length);
}

// --- score ---
const out = [...boards.values()]
  .filter((b) => publishableKeys.has(b.key))
  .map((b) => {
    const families = [...new Set([...b.sources].map((s) => SOURCES[s].family))].sort();
    return {
      key: b.key,
      ats: b.ats,
      slug: b.slug,
      ...(b.region ? { region: b.region } : {}),
      ...(b.shard ? { shard: b.shard } : {}),
      ...(b.site ? { site: b.site } : {}),
      ...(b.name ? { name: b.name } : {}),
      sources: [...b.sources].sort(),
      families,
      confidence: families.length >= 2 ? ("high" as const) : ("single" as const),
    };
  })
  .sort((a, b) => b.families.length - a.families.length || a.key.localeCompare(b.key));

const stats: Record<string, Record<string, number>> = {};
for (const b of out) {
  const s = (stats[b.ats] ??= { total: 0, high: 0, single: 0 });
  s.total = (s.total ?? 0) + 1;
  s[b.confidence] = (s[b.confidence] ?? 0) + 1;
}
mkdirSync(join(catalogDir, "out"), { recursive: true });
writeFileSync(
  join(catalogDir, "out", "merged.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), input_rows: counts, stats, restricted_only: Object.fromEntries([...restrictedOnly].map(([ats, keys]) => [ats, keys.size])), boards: out }),
);
console.log("input rows:", counts);
console.log("merged boards (publishable):", out.length);
console.table(stats);
const fam: Record<number, number> = {};
for (const b of out) fam[b.families.length] = (fam[b.families.length] ?? 0) + 1;
console.log("boards by number of agreeing source families:", fam);
