/**
 * Our own independent board list: ask the Common Crawl URL index which job-board URLs it saw,
 * and reduce them to (ats, slug). No page content is downloaded, only index lines.
 *
 * Incremental: crawls already read are listed in boards.json and skipped, so the first run reads
 * the last CRAWLS_TO_USE crawls (slow, once) and each weekly run reads only crawls published since.
 * Within a crawl, each finished query is recorded (`partial`), so a run that stops part-way
 * continues with the next query instead of starting the crawl again.
 *
 * --per-run caps how many new crawls one run reads, and --max-minutes how long it reads: past it,
 * no new query starts and the crawl is read again next run (boards already found are kept). When
 * the index keeps failing (4 queries in a row) the run stops at once instead of retrying every
 * query: on 10 Oct 2026 an outage cost 2h50m of 2.5-minute retries.
 *
 *   pnpm catalog:crawl [--crawls 24] [--per-run 3] [--max-minutes 60]   -> scripts/catalog/raw/commoncrawl/boards.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient } from "@rawjobs/core";
import { writeFileAtomic } from "./lib/fs";
import { BoardSet, type SeenBoard } from "./lib/url-boards";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(here, "raw", "commoncrawl", "boards.json");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
};
/** Few retries and a breaker: a 503 from an overloaded index is a reason to back off, not to insist. */
export const newCrawlClient = (opts: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
  new HttpClient({
    retries: 2,
    hostDelayMs: 1500,
    timeoutMs: 90_000,
    backoffMs: 10_000,
    breakAfter: 4,
    userAgent: "RawJobs-catalog/0.1 (open-source job radar; reads the CC URL index only)",
    ...opts,
  });

/** URL patterns per host, including the boards' public APIs; workday tenants are subdomains so they use a domain match. */
const QUERIES: { url: string; matchType?: "domain" }[] = [
  { url: "boards.greenhouse.io/*" },
  { url: "job-boards.greenhouse.io/*" },
  { url: "job-boards.eu.greenhouse.io/*" },
  { url: "boards-api.greenhouse.io/v1/boards/*" },
  { url: "jobs.lever.co/*" },
  { url: "jobs.eu.lever.co/*" },
  { url: "api.lever.co/v0/postings/*" },
  { url: "jobs.ashbyhq.com/*" },
  { url: "api.ashbyhq.com/posting-api/job-board/*" },
  { url: "jobs.smartrecruiters.com/*" },
  { url: "careers.smartrecruiters.com/*" },
  { url: "api.smartrecruiters.com/v1/companies/*" },
  { url: "myworkdayjobs.com", matchType: "domain" },
  { url: "myworkdaysite.com", matchType: "domain" },
  // The other hiring systems: boards on a shared path, or one subdomain per company.
  { url: "apply.workable.com/*" },
  { url: "www.comeet.com/jobs/*" },
  { url: "jobs.jobvite.com/*" },
  { url: "ats.rippling.com/*" },
  { url: "join.com/companies/*" },
  { url: "recruitee.com", matchType: "domain" },
  { url: "jobs.personio.de", matchType: "domain" },
  { url: "jobs.personio.com", matchType: "domain" },
  { url: "bamboohr.com", matchType: "domain" },
  { url: "breezy.hr", matchType: "domain" },
  { url: "teamtailor.com", matchType: "domain" },
  { url: "icims.com", matchType: "domain" },
  { url: "taleo.net", matchType: "domain" },
  { url: "pinpointhq.com", matchType: "domain" },
  { url: "applytojob.com", matchType: "domain" },
  { url: "zohorecruit.com", matchType: "domain" },
  { url: "zohorecruit.eu", matchType: "domain" },
  { url: "zohorecruit.in", matchType: "domain" },
  { url: "zohorecruit.com.au", matchType: "domain" },
  { url: "zohorecruit.ca", matchType: "domain" },
  { url: "zohorecruit.sa", matchType: "domain" },
  { url: "zohorecruit.jp", matchType: "domain" },
  { url: "zohorecruit.uk", matchType: "domain" },
  { url: "careers.hibob.com", matchType: "domain" },
  { url: "freshteam.com", matchType: "domain" },
  { url: "successfactors.com", matchType: "domain" },
  { url: "successfactors.eu", matchType: "domain" },
  { url: "fa.us2.oraclecloud.com", matchType: "domain" },
  { url: "fa.us6.oraclecloud.com", matchType: "domain" },
  { url: "fa.em2.oraclecloud.com", matchType: "domain" },
  { url: "fa.em3.oraclecloud.com", matchType: "domain" },
  { url: "fa.em5.oraclecloud.com", matchType: "domain" },
  { url: "fa.ocs.oraclecloud.com", matchType: "domain" },
  { url: "fa.ap1.oraclecloud.com", matchType: "domain" },
  { url: "fa.ca2.oraclecloud.com", matchType: "domain" },
];

/**
 * `queries`: the URL patterns those crawls were read with; a pattern added later is read in them too.
 * `partial`: per crawl not done yet, the queries already read in full (every page).
 */
type Saved = { generated_at: string; crawls: string[]; queries?: string[]; partial?: Record<string, string[]>; index_lines: number; boards: (SeenBoard & { crawls?: string[] })[] };

const queryId = (q: { url: string; matchType?: string }) => `${q.url}|${q.matchType ?? ""}`;

/** The queries a crawl still needs: all of them (or only new patterns, for a crawl read before), minus those finished. */
export const queriesFor = <Q extends { url: string; matchType?: string }>(planned: Q[], finished: string[] | undefined): Q[] => {
  const skip = new Set(finished ?? []);
  return planned.filter((q) => !skip.has(queryId(q)));
};

export type CrawlRun = {
  http: HttpClient;
  out: string;
  index?: string;
  /**
   * How many of the newest crawls to read (default 24, about two years). The workflows read the 12
   * newest first (`--crawls 12`); go further back only if older crawls still turn up live boards.
   */
  crawlsToUse?: number;
  perRun?: number;
  maxMs?: number;
  now?: () => number;
};

/** Why a run ended: everything planned was read, the time ran out, or the index stopped answering. */
export type CrawlEnd = "done" | "out of time" | "index unavailable";

export async function readCrawls({ http, out, index = "https://index.commoncrawl.org", crawlsToUse = 24, perRun = Infinity, maxMs = Infinity, now = Date.now }: CrawlRun): Promise<CrawlEnd> {
  const started = now();
  const indexHost = new URL(index).host;
  const stopReason = (): CrawlEnd | undefined => (http.stats.brokenHosts.includes(indexHost) ? "index unavailable" : now() - started >= maxMs ? "out of time" : undefined);
  const prev: Saved | undefined = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : undefined;
  // Older files listed crawls per board as `crawls`.
  const boards = new BoardSet((prev?.boards ?? []).map(({ crawls, seen, ...b }) => ({ ...b, seen: seen ?? crawls ?? [] })));
  const done = new Set(prev?.crawls ?? []);
  const partial: Record<string, string[]> = { ...prev?.partial };
  const readBefore = new Set(done);
  // Files from before `queries` was recorded were read with the first 13 patterns.
  const knownQueries = new Set(prev?.queries ?? (prev ? QUERIES.slice(0, 13).map(queryId) : []));
  const newQueries = QUERIES.filter((q) => !knownQueries.has(queryId(q)));
  let recent: string[];
  try {
    recent = (await http.getJson<{ id: string }[]>(`${index}/collinfo.json`)).slice(0, crawlsToUse).map((c) => c.id);
  } catch (err) {
    console.error(`Crawl list failed (${(err as Error).message})`);
    return "index unavailable";
  }
  // Newest first, so a capped run always picks up the latest crawl.
  // Crawls not read yet (every pattern), then crawls read before new patterns were added (those only).
  const todo = [...recent.filter((c) => !done.has(c)), ...(newQueries.length ? recent.filter((c) => done.has(c)) : [])].slice(0, perRun);
  const backfilled = new Set<string>();
  console.error(`Crawls: ${recent.length} recent, reading ${todo.length} this run${todo.length ? `: ${todo.join(", ")}` : ""}`);
  let lines = prev?.index_lines ?? 0;

  const save = () => {
    // New patterns count as known once every recent crawl has been read with them.
    const queries = recent.filter((c) => readBefore.has(c)).every((c) => backfilled.has(c)) ? QUERIES.map(queryId) : [...knownQueries];
    const saved: Saved = { generated_at: new Date().toISOString(), crawls: [...done].sort().reverse(), queries, partial, index_lines: lines, boards: boards.list() };
    writeFileAtomic(out, JSON.stringify(saved));
  };

  let end: CrawlEnd = "done";
  for (const crawl of todo) {
    let complete = true;
    const backfill = done.has(crawl);
    for (const q of queriesFor(backfill ? newQueries : QUERIES, partial[crawl])) {
      const stop = stopReason();
      if (stop) {
        end = stop;
        complete = false;
        break;
      }
      const base = `${index}/${crawl}-index?url=${encodeURIComponent(q.url)}${q.matchType ? `&matchType=${q.matchType}` : ""}&fl=url&filter=!status:404&output=json`;
      let pages = 1;
      try {
        pages = (await http.getJson<{ pages: number }>(`${base}&showNumPages=true`)).pages;
      } catch (err) {
        console.error(`  ${crawl} ${q.url}: page count failed (${(err as Error).message}); skipping`);
        complete = false;
        continue;
      }
      let queryDone = true;
      for (let page = 0; page < pages; page++) {
        const stop = stopReason();
        if (stop) {
          end = stop;
          complete = false;
          queryDone = false;
          break;
        }
        let text = "";
        try {
          text = await http.getText(`${base}&page=${page}`);
        } catch (err) {
          console.error(`  ${crawl} ${q.url} page ${page}: ${(err as Error).message}`);
          complete = false;
          queryDone = false;
          continue;
        }
        // output=json gives one {"url": …} object per line.
        for (const raw of text.split("\n")) {
          if (!raw.trim()) continue;
          try {
            boards.add((JSON.parse(raw) as { url: string }).url, crawl);
            lines++;
          } catch {
            // not a JSON line
          }
        }
        console.error(`  ${crawl} ${q.url} page ${page + 1}/${pages}: ${boards.size} boards so far`);
      }
      if (queryDone) {
        partial[crawl] = [...(partial[crawl] ?? []), queryId(q)];
        save();
      }
    }
    // A crawl with failed pages is read again next run (boards already found are kept).
    if (complete) {
      if (backfill) backfilled.add(crawl);
      done.add(crawl);
      delete partial[crawl];
    }
    save();
    if (end !== "done") break;
  }
  save();
  console.error(`Done: ${lines} index lines -> ${boards.size} boards`, boards.byAts());
  return end;
}

async function main() {
  const end = await readCrawls({ http: newCrawlClient(), out: OUT_FILE, crawlsToUse: arg("--crawls"), perRun: arg("--per-run"), maxMs: (arg("--max-minutes") ?? Infinity) * 60_000 });
  if (end === "out of time") console.error("Out of time; continues next run.");
  if (end === "index unavailable") console.error("Common Crawl index unavailable; continues next run.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
