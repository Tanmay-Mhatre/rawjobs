/**
 * A second independent board list: the Internet Archive's Wayback Machine URL index (CDX), which
 * archives pages that Common Crawl's robots rules and sampling miss. Only index lines are read,
 * never page content, and each line is reduced to (ats, slug) like commoncrawl.ts does.
 *
 * Resumable and time-boxed: progress per query is saved after every page, so the weekly rebuild
 * reads for --max-minutes and carries on next week. A finished pass starts again after 30 days.
 * When the archive keeps failing (3 requests in a row) the run stops instead of retrying every query.
 *
 *   pnpm catalog:wayback [--max-minutes 90] [--since-years 3] [--pages 2]   -> raw/wayback/boards.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient } from "@rawjobs/core";
import { writeFileAtomic } from "./lib/fs";
import { BoardSet, type SeenBoard } from "./lib/url-boards";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "raw", "wayback", "boards.json");
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const MAX_MS = arg("--max-minutes", 90) * 60_000;
/** Snapshots older than this are ignored: those boards are very likely gone. */
const SINCE = String(new Date().getUTCFullYear() - arg("--since-years", 3));
/** Pages per query (testing: --pages 2). */
const PAGE_LIMIT = arg("--pages", Infinity);
const REPASS_DAYS = 30;
const CDX = "https://web.archive.org/cdx/search/cdx";
// The archive asks for gentle use: one request at a time, a few seconds apart.
const http = new HttpClient({
  retries: 4,
  hostDelayMs: 3_000,
  timeoutMs: 180_000,
  backoffMs: 30_000,
  breakAfter: 3,
  userAgent: "RawJobs-catalog/0.1 (open-source job radar; reads the CDX index only)",
});
const archiveDown = () => http.stats.brokenHosts.includes(new URL(CDX).host);

/** Same hosts as commoncrawl.ts. Paged queries can't take a date filter, so dates are checked per line. */
const QUERIES: { url: string; matchType: "prefix" | "domain" }[] = [
  { url: "boards.greenhouse.io/", matchType: "prefix" },
  { url: "job-boards.greenhouse.io/", matchType: "prefix" },
  { url: "job-boards.eu.greenhouse.io/", matchType: "prefix" },
  { url: "boards-api.greenhouse.io/v1/boards/", matchType: "prefix" },
  { url: "jobs.lever.co/", matchType: "prefix" },
  { url: "jobs.eu.lever.co/", matchType: "prefix" },
  { url: "api.lever.co/v0/postings/", matchType: "prefix" },
  { url: "jobs.ashbyhq.com/", matchType: "prefix" },
  { url: "api.ashbyhq.com/posting-api/job-board/", matchType: "prefix" },
  { url: "jobs.smartrecruiters.com/", matchType: "prefix" },
  { url: "careers.smartrecruiters.com/", matchType: "prefix" },
  { url: "myworkdayjobs.com", matchType: "domain" },
  { url: "myworkdaysite.com", matchType: "domain" },
  { url: "apply.workable.com/", matchType: "prefix" },
  { url: "www.comeet.com/jobs/", matchType: "prefix" },
  { url: "jobs.jobvite.com/", matchType: "prefix" },
  { url: "ats.rippling.com/", matchType: "prefix" },
  { url: "join.com/companies/", matchType: "prefix" },
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
  { url: "recruiting.paylocity.com/Recruiting/Jobs/All/", matchType: "prefix" },
  { url: "www.paycomonline.net/v4/ats/web.php/portal/", matchType: "prefix" },
  { url: "careers.hireology.com/", matchType: "prefix" },
  { url: "ultipro.com", matchType: "domain" },
  { url: "rec.pro.ukg.net", matchType: "domain" },
  { url: "eightfold.ai", matchType: "domain" },
  { url: "careerplug.com", matchType: "domain" },
  { url: "jobs.dayforcehcm.com/", matchType: "prefix" },
  { url: "workforcenow.adp.com/mascsr/default/mdf/recruitment/", matchType: "prefix" },
  { url: "applicantpro.com", matchType: "domain" },
  { url: "isolvedhire.com", matchType: "domain" },
  { url: "recruitingbypaycor.com/career/", matchType: "prefix" },
  { url: "hiringthing.com", matchType: "domain" },
  { url: "prismhr-hire.com", matchType: "domain" },
  { url: "oasisrecruit.com", matchType: "domain" },
  { url: "www.careers-page.com/", matchType: "prefix" },
  { url: "hire.trakstar.com", matchType: "domain" },
  { url: "factorialhr.com", matchType: "domain" },
  { url: "factorial.es", matchType: "domain" },
];

type Progress = { pages?: number; next: number };
type Saved = { generated_at: string; pass_started_at: string; completed_at?: string; index_lines: number; progress: Record<string, Progress>; boards: SeenBoard[] };

async function main() {
  const started = Date.now();
  let saved: Saved | undefined = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : undefined;
  if (saved?.completed_at && Date.now() - Date.parse(saved.completed_at) > REPASS_DAYS * 86_400_000) {
    console.error(`Last pass finished ${saved.completed_at.slice(0, 10)}; starting a new one (boards kept).`);
    saved = { ...saved, completed_at: undefined, pass_started_at: new Date().toISOString(), progress: {} };
  }
  const state: Saved = saved ?? { generated_at: "", pass_started_at: new Date().toISOString(), index_lines: 0, progress: {}, boards: [] };
  // A query added since the pass finished reopens it (only the new query has pages left).
  if (state.completed_at && QUERIES.some((q) => !state.progress[`${q.url}|${q.matchType}`])) state.completed_at = undefined;
  if (state.completed_at) {
    console.error(`Pass finished ${state.completed_at.slice(0, 10)}; nothing to do until ${REPASS_DAYS} days later.`);
    return;
  }
  const boards = new BoardSet(state.boards);
  const save = () => {
    writeFileAtomic(OUT, JSON.stringify({ ...state, generated_at: new Date().toISOString(), boards: boards.list() }));
  };

  let outOfTime = false;
  for (const q of QUERIES) {
    if (Date.now() - started > MAX_MS) {
      outOfTime = true;
      break;
    }
    if (archiveDown()) break;
    const id = `${q.url}|${q.matchType}`;
    const p = (state.progress[id] ??= { next: 0 });
    const base = `${CDX}?url=${encodeURIComponent(q.url)}&matchType=${q.matchType}`;
    if (p.pages === undefined) {
      try {
        p.pages = Number((await http.getText(`${base}&showNumPages=true`)).trim());
      } catch (err) {
        console.error(`  ${q.url}: page count failed (${(err as Error).message}); skipping this run`);
        continue;
      }
    }
    const last = Math.min(p.pages, PAGE_LIMIT);
    for (; p.next < last; p.next++) {
      if (Date.now() - started > MAX_MS) {
        outOfTime = true;
        break;
      }
      let text: string;
      try {
        text = await http.getText(`${base}&fl=original,timestamp&filter=statuscode:200&collapse=urlkey&page=${p.next}`);
      } catch (err) {
        // Leave `next` here: the page is tried again next run.
        console.error(`  ${q.url} page ${p.next}: ${(err as Error).message}; stopping this query for now`);
        break;
      }
      for (const line of text.split("\n")) {
        const sp = line.lastIndexOf(" ");
        if (sp < 0) continue;
        const year = line.slice(sp + 1, sp + 5);
        if (year < SINCE) continue;
        state.index_lines++;
        boards.add(line.slice(0, sp), year);
      }
      if (p.next % 10 === 0 || p.next === last - 1) console.error(`  ${q.url} page ${p.next + 1}/${p.pages}: ${boards.size} boards`);
      save();
    }
    if (outOfTime) break;
  }
  const finished = QUERIES.every((q) => {
    const p = state.progress[`${q.url}|${q.matchType}`];
    return p?.pages !== undefined && p.next >= Math.min(p.pages, PAGE_LIMIT);
  });
  if (finished && PAGE_LIMIT === Infinity) state.completed_at = new Date().toISOString();
  save();
  console.error(
    `${finished ? "Pass complete" : outOfTime ? "Out of time; continues next run" : archiveDown() ? "Wayback index unavailable; continues next run" : "Stopped early; continues next run"}: ${boards.size} boards`,
    boards.byAts(),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
