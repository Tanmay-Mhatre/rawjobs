/**
 * Collect each live company's open jobs as slim rows (title, location, workplace, age), so a user's
 * copy can see which companies have jobs that pass *their* filters. No descriptions are kept.
 * Resumable, one output file per process (like check.ts).
 *
 *   pnpm exec tsx scripts/catalog/index.ts --ats greenhouse
 *   pnpm exec tsx scripts/catalog/index.ts --ats lever,ashby,smartrecruiters
 *   --max-age-days 7   re-fetch companies indexed more than 7 days ago
 *   --max-minutes 30   stop starting new companies after 30 minutes (rows are appended as they
 *                      come, and publish keeps each company's newest row, so stopping loses nothing)
 *   --feed out/feed    take rows from the job feed's second format there (feed.sh) for the companies
 *                      it read within --max-age-days, and read only the rest live (lib/index-feed.ts)
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConnector, HttpClient, type HttpError, inferWorkplace, type CompanyRef, type NormalizedJob } from "@rawjobs/core";
import { readFeedV2 } from "./lib/feed-v2";
import { planIndex, toRows, type IndexEntry as Entry } from "./lib/index-feed";
import { maxMsFromArgs, nextInTime } from "./lib/time-box";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "out");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ONLY = new Set((arg("--ats") ?? "greenhouse,lever,ashby,smartrecruiters").split(","));
const MAX_AGE_DAYS = Number(arg("--max-age-days") ?? 30);
const FEED = arg("--feed");
const MAX_MS = maxMsFromArgs();
const OUT = join(OUT_DIR, `index-${[...ONLY].sort().join("-")}.jsonl`);
const WORKERS: Record<string, number> = { greenhouse: 2, lever: 2, ashby: 2, smartrecruiters: 2 };

const http = new HttpClient({ retries: 2, hostDelayMs: 250, timeoutMs: 30_000, backoffMs: 3_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; low-rate board index)" });

/** Greenhouse without descriptions: the light list is enough for titles and locations. */
async function greenhouseLight(ref: CompanyRef): Promise<NormalizedJob[]> {
  type G = { id: number; title: string; location?: { name?: string }; absolute_url: string; first_published?: string; updated_at?: string };
  const d = await http.getJson<{ jobs?: G[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.slug)}/jobs`);
  return (d.jobs ?? []).map((j) => {
    const location = j.location?.name?.trim() ?? "";
    return {
      id: String(j.id),
      ats: "greenhouse",
      company: ref.name,
      title: j.title.trim(),
      location,
      workplace: inferWorkplace(location),
      postedAt: j.first_published ?? j.updated_at,
      url: j.absolute_url,
    };
  });
}

async function fetchJobs(e: Entry): Promise<NormalizedJob[]> {
  const ref = { name: e.name, ats: e.ats, slug: e.slug, region: e.region, enabled: true } as CompanyRef;
  if (e.ats === "greenhouse") return greenhouseLight(ref);
  const c = getConnector(ref.ats)!;
  const raws = await c.fetch(ref, { http, now: new Date() });
  return raws.map((r) => c.normalize(r, ref));
}

async function main() {
  const dir = JSON.parse(readFileSync(join(OUT_DIR, "directory.json"), "utf8")) as { companies: Entry[] };
  // When each company was last indexed without an error.
  const indexed = new Map<string, string>();
  for (const f of readdirSync(OUT_DIR).filter((n) => /^index-.+\.jsonl$/.test(n))) {
    for (const line of readFileSync(join(OUT_DIR, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as { key: string; fetched_at: string; error?: string };
      const had = indexed.get(r.key);
      if (!r.error && (!had || Date.parse(had) < Date.parse(r.fetched_at))) indexed.set(r.key, r.fetched_at);
    }
  }
  // Without a readable feed (feed.sh failed or fell back to the first format), everything is read live.
  const feed = FEED ? readFeedV2(FEED)?.state : undefined;
  if (FEED && !feed) console.error(`Couldn't read the job feed in ${FEED}: every company is read live.`);
  const plan = planIndex(
    dir.companies.filter((c) => c.status === "live" && ONLY.has(c.ats)),
    feed,
    indexed,
    { now: Date.now(), maxAgeDays: MAX_AGE_DAYS },
  );
  if (plan.fromFeed.length) appendFileSync(OUT, plan.fromFeed.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const todo = plan.live;
  console.error(`${plan.fromFeed.length} companies from the job feed, ${todo.length} to read live, ${plan.stale} refused as stale, ${plan.fresh} already fresh`);

  const lanes = new Map<string, Entry[]>();
  for (const e of todo) {
    if (!lanes.has(e.ats)) lanes.set(e.ats, []);
    lanes.get(e.ats)!.push(e);
  }
  let n = 0;
  const started = Date.now();
  await Promise.all(
    [...lanes.entries()].flatMap(([ats, list]) =>
      Array.from({ length: WORKERS[ats] ?? 1 }, async () => {
        for (let e = nextInTime(list, started, MAX_MS); e; e = nextInTime(list, started, MAX_MS)) {
          let line: Record<string, unknown>;
          try {
            const jobs = await fetchJobs(e);
            line = { key: e.key, fetched_at: new Date().toISOString(), open_jobs: jobs.length, rows: toRows(jobs, Date.now()) };
          } catch (err) {
            const h = err as HttpError;
            line = { key: e.key, fetched_at: new Date().toISOString(), error: `${h.status ?? ""} ${h.message}`.trim().slice(0, 120) };
          }
          appendFileSync(OUT, `${JSON.stringify(line)}\n`);
          if (++n % 250 === 0) {
            const rate = n / ((Date.now() - started) / 1000);
            console.error(`  ${n}/${todo.length} (${rate.toFixed(1)}/s, ~${Math.round((todo.length - n) / rate / 60)} min left)`);
          }
        }
      }),
    ),
  );
  const left = [...lanes.values()].reduce((sum, list) => sum + list.length, 0);
  console.error(left ? `Stopped after ${MAX_MS / 60_000} min: ${left} left for the next run.` : "Done.");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const source = !FEED ? "job feed off" : feed ? `${plan.fromFeed.length} companies from the job feed` : "job feed unreadable, so off";
    const limit = left ? ` (${left} left by the time limit)` : "";
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Index open jobs: ${source}, ${n} read live${limit}, ${plan.stale} refused as stale (feed read over ${MAX_AGE_DAYS} days ago), ${plan.fresh} already fresh.\n\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
