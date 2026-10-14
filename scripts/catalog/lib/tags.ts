/**
 * Industry tags for directory companies, and where each came from (publish.ts).
 *
 * Sources, by how sure they are of what the company *is*:
 *   list      a hand-made list says so: the seed list, the curated list, a source list's category
 *   wikidata  the company's industry on Wikidata (CC0), matched by its board or by name + website
 *   titles    its job titles: what it hires for, which usually but not always is what it is
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { readFeedV2 } from "./feed-v2";

export type TagSource = "list" | "wikidata" | "titles";

/** The source names publish.ts records in out/tags.json, by kind. */
export const TITLES_SOURCE = "job titles";
export const WIKIDATA_SOURCE = "wikidata";
const kindOf = (source: string): TagSource => (source === TITLES_SOURCE ? "titles" : source === WIKIDATA_SOURCE ? "wikidata" : "list");
const RANK: Record<TagSource, number> = { list: 0, wikidata: 1, titles: 2 };

/** What a directory company carries: see tagsOf. */
export type CompanyTags = { tags?: string[]; title_tags?: string[]; tag_src?: Record<string, Exclude<TagSource, "list">> };

/** Company key -> industry id -> the sources that gave it. */
export class TagBook {
  readonly byKey = new Map<string, Map<string, Set<string>>>();

  add(key: string, ids: readonly string[], source: string) {
    for (const id of ids) {
      if (!this.byKey.has(key)) this.byKey.set(key, new Map());
      const m = this.byKey.get(key)!;
      if (!m.has(id)) m.set(id, new Set());
      m.get(id)!.add(source);
    }
  }

  /** Industries known so far (any source). */
  known(key: string): string[] {
    return [...(this.byKey.get(key)?.keys() ?? [])];
  }

  /**
   * `tags`: industries a list or Wikidata puts the company in. `title_tags`: industries only its job
   * titles point to. Titles say what a company hires for, not what it is (Anthropic's say "Inference",
   * not "AI"), so the two stay apart, as apps have always read them. `tag_src` names the source of each
   * tag that isn't from a hand-made list (absent: a list), so the app can say "from its job titles".
   */
  tagsOf(key: string): CompanyTags {
    const m = this.byKey.get(key);
    if (!m) return {};
    const tags: string[] = [];
    const titleTags: string[] = [];
    const src: Record<string, Exclude<TagSource, "list">> = {};
    for (const [id, sources] of m) {
      const best = [...sources].map(kindOf).sort((a, b) => RANK[a] - RANK[b])[0]!;
      (best === "titles" ? titleTags : tags).push(id);
      if (best !== "list") src[id] = best;
    }
    return {
      ...(tags.length ? { tags: tags.sort() } : {}),
      ...(titleTags.length ? { title_tags: titleTags.sort() } : {}),
      ...(Object.keys(src).length ? { tag_src: Object.fromEntries(Object.entries(src).sort(([a], [b]) => a.localeCompare(b))) } : {}),
    };
  }

  /** For out/tags.json: key -> id -> sources. */
  toJSON() {
    return Object.fromEntries([...this.byKey].map(([k, m]) => [k, Object.fromEntries([...m].map(([id, src]) => [id, [...src]]))]));
  }
}

/** Each line of a JSONL file that parses (a line cut off by a kill is skipped). */
function* jsonl<T>(path: string): Generator<T> {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      yield JSON.parse(line) as T;
    } catch {
      // half-written last line
    }
  }
}

/** Job titles the live checks kept (out/titles*.jsonl, check.ts): the newest list per company key. */
export function readCheckTitles(outDir: string): Map<string, string[]> {
  const latest = new Map<string, { fetched_at: string; titles: string[] }>();
  if (!existsSync(outDir)) return new Map();
  for (const f of readdirSync(outDir).filter((n) => /^titles(-.+)?\.jsonl$/.test(n))) {
    for (const r of jsonl<{ key: string; fetched_at: string; titles?: string[] }>(join(outDir, f))) {
      if (!r.titles?.length) continue;
      const prev = latest.get(r.key);
      if (!prev || prev.fetched_at <= r.fetched_at) latest.set(r.key, { fetched_at: r.fetched_at, titles: r.titles });
    }
  }
  return new Map([...latest].map(([k, v]) => [k, v.titles]));
}

/** Most titles read per company from the job feed (the job index keeps as many rows). */
const FEED_TITLES = 300;

/** The first `FEED_TITLES` non-empty titles of a company's feed rows ([id, title, …]). */
const titlesOfRows = (rows: readonly unknown[][] | undefined) =>
  (rows ?? [])
    .slice(0, FEED_TITLES)
    .map((row) => row[1])
    .filter((t): t is string => typeof t === "string" && t.length > 0);

/**
 * Job titles from the shared job feed (the "jobs" release, downloaded into `feedDir` by feed.sh), by the
 * feed's company key (jobCompanyKey). Read from the second format's full copy (jobs-v2-manifest.json and
 * the snapshot it names); when that isn't there, from the first format's shards (jobs-manifest.json).
 * Missing or unreadable: none.
 */
export function readFeedTitles(feedDir: string): Map<string, string[]> {
  const v2 = readFeedV2(feedDir);
  if (v2) {
    const out = new Map<string, string[]>();
    for (const [key, rows] of Object.entries(v2.state.jobs)) {
      const titles = titlesOfRows(rows);
      if (titles.length) out.set(key, titles);
    }
    return out;
  }
  return readFeedTitlesV1(feedDir);
}

const V1_SHARD = /^jobs-[a-z0-9-]+-[0-9A-Za-z]+\.json\.gz$/;

/** The first format: one gzipped shard per hiring system, named in jobs-manifest.json. */
function readFeedTitlesV1(feedDir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const manifestPath = join(feedDir, "jobs-manifest.json");
  if (!existsSync(manifestPath)) return out;
  let manifest: { shards?: Record<string, { file: string }> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return out;
  }
  for (const { file } of Object.values(manifest.shards ?? {})) {
    // Only plain shard file names, as feed.sh downloads them.
    if (typeof file !== "string" || !V1_SHARD.test(file)) continue;
    const path = join(feedDir, file);
    if (!existsSync(path)) continue;
    try {
      const shard = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as { companies?: Record<string, { jobs?: unknown[][] }> };
      for (const [key, c] of Object.entries(shard.companies ?? {})) {
        const titles = titlesOfRows(c.jobs);
        if (titles.length) out.set(key, titles);
      }
    } catch (err) {
      console.error(`! job feed shard ${file} unreadable, skipped: ${(err as Error).message}`);
    }
  }
  return out;
}
