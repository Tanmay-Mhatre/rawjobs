/** Reduce crawled URLs (Common Crawl, Wayback) to job boards, shared by commoncrawl.ts and wayback.ts. */
import { ATS_TYPES, companyKey, detectCompany } from "@rawjobs/core";

export type UrlBoard = { ats: string; slug: string; region?: string; shard?: string; site?: string };
/** A board plus the crawls (or snapshots) it was seen in. */
export type SeenBoard = UrlBoard & { seen: string[] };

/** Paths on board hosts that are the host's own pages, not company boards. */
const IGNORE = new Set(["embed", "v1", "v0", "api", "jobs", "favicon.ico", "robots.txt", "sitemap.xml", "assets", "static", "_next", "search", "oauth", "login", "privacy", "terms", "wday", "cxs"]);
/** Words in IGNORE that are also real Workday site names. */
const WORKDAY_SITE_NAMES = new Set(["jobs", "search"]);
const TRACKED = new Set<string>(ATS_TYPES);

/** One URL -> the board it belongs to, or null when it isn't a company board we track. */
export function boardFromUrl(url: string): UrlBoard | null {
  const d = detectCompany(url);
  if (!d || !TRACKED.has(d.ats)) return null;
  const slug = d.slug.trim();
  if (!slug || slug.length > 80 || IGNORE.has(slug.toLowerCase()) || /[\s<>"{}|\\^`]/.test(slug)) return null;
  // Workday sites can really be named "jobs" or "search" (PayPal, Parsons), so those two stay.
  if (d.ats === "workday" && (!d.shard || !d.site || (IGNORE.has(d.site.toLowerCase()) && !WORKDAY_SITE_NAMES.has(d.site.toLowerCase())))) return null;
  // A Taleo pod hosts many companies: without the section it isn't one board. Oracle needs its data centre.
  if ((d.ats === "taleo" && !d.site) || (d.ats === "oracle" && !d.shard) || (d.ats === "comeet" && !d.site) || (d.ats === "ukg" && (!d.shard || !d.site)) || (d.ats === "dayforce" && !d.site))
    return null;
  return { ats: d.ats, slug, ...(d.region ? { region: d.region } : {}), ...(d.shard ? { shard: d.shard } : {}), ...(d.site ? { site: d.site } : {}) };
}

/** Boards seen so far, keyed like the directory; `add` records which crawl saw each. */
export class BoardSet {
  private readonly boards = new Map<string, { board: UrlBoard; seen: Set<string> }>();

  constructor(previous: SeenBoard[] = []) {
    for (const { seen, ...board } of previous) this.boards.set(companyKey(board), { board, seen: new Set(seen) });
  }

  /** Returns true when the URL was a board. */
  add(url: string, seenIn: string): boolean {
    const b = boardFromUrl(url);
    if (!b) return false;
    const key = companyKey(b);
    const prev = this.boards.get(key);
    if (prev) {
      prev.seen.add(seenIn);
      if (!prev.board.region && b.region) prev.board.region = b.region;
    } else this.boards.set(key, { board: b, seen: new Set([seenIn]) });
    return true;
  }

  get size(): number {
    return this.boards.size;
  }

  list(): SeenBoard[] {
    return [...this.boards.values()].map(({ board, seen }) => ({ ...board, seen: [...seen].sort() }));
  }

  byAts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const { board } of this.boards.values()) out[board.ats] = (out[board.ats] ?? 0) + 1;
    return out;
  }
}
