/**
 * Boards learned from the public job boards the app reads (JOB_BOARDS: Hacker News, Remotive,
 * Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely, Remote First Jobs). Many of their jobs link to the
 * company's own hiring system (the apply link, or links in the post), and that link names a board.
 *
 * Only the board each link names is kept (hiring system + slug), with which feeds saw it and when:
 * never a job, a title, a company name or any other part of the feed. Merged as the "feeds" family,
 * so new boards go through the usual live check before they're published.
 *
 * Each feed is read with its own connector, at most as often as the connector allows
 * (minIntervalHours: some boards ask for few requests a day), so running this every 3 hours is fine.
 * Accumulates across runs (the file is in the saved state); a feed that fails is skipped until next run.
 *
 *   pnpm catalog:feed-boards [--max-minutes 5]   -> raw/feeds/boards.json
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CompanyRef, companyKey, type Connector, getConnector, HttpClient, JOB_BOARDS } from "@rawjobs/core";
import { writeFileAtomic } from "./lib/fs";
import { catalogDir } from "./lib/paths";
import { boardFromUrl, type UrlBoard } from "./lib/url-boards";

export const OUT_FILE = join(catalogDir, "raw", "feeds", "boards.json");

export type FeedBoard = UrlBoard & { feeds: string[]; first_seen: string; last_seen: string };
export type FeedBoardsFile = { generated_at?: string; fetched: Record<string, string>; boards: FeedBoard[] };

/** The feed reference each job board is read with: its whole, newest list. */
const REF: Record<string, string> = { hackernews: "whoishiring" };
const refFor = (ats: string, c: Connector): CompanyRef => ({ name: c.label ?? ats, ats: ats as CompanyRef["ats"], slug: REF[ats] ?? "all", enabled: true });

/** The few entities links arrive with (HN writes "https:&#x2F;&#x2F;…"). */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[code.toLowerCase()] ?? m;
  });
}

const URL_RE = /https?:\/\/[^\s"'<>()[\]{}\\^`|]+/gi;

/** Every http(s) URL in one feed item: its fields (apply links) and the links in its text, plus URLs passed along in a link's query. */
export function urlsIn(item: unknown): string[] {
  const strings: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x, depth);
    // Only the item's own fields: HN replies (children) are other people's comments.
    else if (v && typeof v === "object" && depth === 0) for (const [k, x] of Object.entries(v)) if (k !== "children") walk(x, depth + 1);
  };
  walk(item, 0);
  const out = new Set<string>();
  for (const s of strings) {
    for (const m of decodeEntities(s).matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;:!?*'"]+$/, "");
      out.add(url);
      // Tracking links and redirects carry the real one: ?url=https%3A%2F%2Fjobs.lever.co%2F…
      try {
        for (const value of new URL(url).searchParams.values()) if (/^https?:\/\//i.test(value)) out.add(value);
      } catch {
        // not a URL after all
      }
    }
  }
  return [...out];
}

/** The boards a feed's items link to, one per board. */
export function boardsInItems(items: unknown[]): UrlBoard[] {
  const found = new Map<string, UrlBoard>();
  for (const item of items) {
    for (const url of urlsIn(item)) {
      const b = boardFromUrl(url);
      if (b && !found.has(companyKey(b))) found.set(companyKey(b), b);
    }
  }
  return [...found.values()];
}

export function readFeedBoards(path: string): FeedBoardsFile {
  if (!existsSync(path)) return { fetched: {}, boards: [] };
  const f = JSON.parse(readFileSync(path, "utf8")) as Partial<FeedBoardsFile>;
  return { generated_at: f.generated_at, fetched: f.fetched ?? {}, boards: f.boards ?? [] };
}

/** Add one feed's boards to what earlier runs found. */
export function mergeFeedBoards(file: FeedBoardsFile, feed: string, found: UrlBoard[], day: string): { added: number } {
  const byKey = new Map(file.boards.map((b) => [companyKey(b), b]));
  let added = 0;
  for (const b of found) {
    const prev = byKey.get(companyKey(b));
    if (prev) {
      if (!prev.feeds.includes(feed)) prev.feeds = [...prev.feeds, feed].sort();
      if (day > prev.last_seen) prev.last_seen = day;
      if (!prev.region && b.region) prev.region = b.region;
      continue;
    }
    const row: FeedBoard = { ...b, feeds: [feed], first_seen: day, last_seen: day };
    byKey.set(companyKey(b), row);
    file.boards.push(row);
    added++;
  }
  return { added };
}

export type FeedRun = { feed: string; outcome: "read" | "not due" | "failed" | "out of time"; items?: number; boards?: number; added?: number; error?: string };

/** Read every job board that's due, saving after each one. */
export async function readFeeds(opts: {
  http: HttpClient;
  out: string;
  feeds?: readonly string[];
  maxMs?: number;
  now?: () => Date;
  getConnector?: (ats: string) => Connector | undefined;
}): Promise<FeedRun[]> {
  const now = opts.now ?? (() => new Date());
  const lookup = opts.getConnector ?? ((ats: string) => getConnector(ats as CompanyRef["ats"]));
  const start = now().getTime();
  const file = readFeedBoards(opts.out);
  const runs: FeedRun[] = [];
  for (const feed of opts.feeds ?? JOB_BOARDS) {
    const c = lookup(feed);
    if (!c) continue;
    const t = now();
    if (t.getTime() - start > (opts.maxMs ?? Infinity)) {
      runs.push({ feed, outcome: "out of time" });
      continue;
    }
    const last = file.fetched[feed] ? Date.parse(file.fetched[feed]) : 0;
    if (t.getTime() - last < (c.minIntervalHours ?? 0) * 3_600_000) {
      runs.push({ feed, outcome: "not due" });
      continue;
    }
    try {
      const items = await c.fetch(refFor(feed, c), { http: opts.http, now: t });
      const found = boardsInItems(items);
      const { added } = mergeFeedBoards(file, feed, found, t.toISOString().slice(0, 10));
      file.fetched[feed] = t.toISOString();
      file.generated_at = t.toISOString();
      writeFileAtomic(opts.out, JSON.stringify(file));
      runs.push({ feed, outcome: "read", items: items.length, boards: found.length, added });
    } catch (err) {
      // Counted as a try, so a broken feed isn't asked again before its interval.
      file.fetched[feed] = t.toISOString();
      writeFileAtomic(opts.out, JSON.stringify(file));
      runs.push({ feed, outcome: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return runs;
}

async function main() {
  const i = process.argv.indexOf("--max-minutes");
  const maxMs = i > 0 ? Number(process.argv[i + 1]) * 60_000 : Infinity;
  const http = new HttpClient({
    retries: 1,
    hostDelayMs: 1_000,
    timeoutMs: 30_000,
    backoffMs: 5_000,
    userAgent: "RawJobs-catalog/0.1 (open-source job radar; reads job boards' public feeds for careers links)",
  });
  const runs = await readFeeds({ http, out: OUT_FILE, maxMs });
  for (const r of runs) console.error(`  ${r.feed}: ${r.outcome}${r.outcome === "read" ? ` (${r.items} jobs, ${r.boards} boards, ${r.added} new)` : r.error ? ` (${r.error})` : ""}`);
  const total = readFeedBoards(OUT_FILE).boards;
  const byAts: Record<string, number> = {};
  for (const b of total) byAts[b.ats] = (byAts[b.ats] ?? 0) + 1;
  console.error(`Done: ${total.length} boards from job feeds so far`, byAts);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
