/**
 * The shared job feed (packages/core/src/job-feed.ts): every live directory board's open jobs as
 * slim rows, one gzipped shard per hiring system, rebuilt daily by the "Jobs · daily feed" workflow.
 * Scans use it to skip companies with nothing for a user; they still fetch the rest live.
 *
 *   pnpm exec tsx scripts/catalog/jobs.ts [--directory out/directory.json] [--out out/jobs]
 *     [--ats greenhouse,lever,ashby,smartrecruiters,workday] [--max-minutes 300]
 *
 * Unchanged boards cost an empty 304 (ETags kept in <out>/etags.json, for the one-request feeds).
 * A board that fails, or that the time limit leaves out, keeps yesterday's rows and date: clients
 * ignore entries older than 3 days and fetch those companies live.
 * Writes <out>/jobs-<ats>-<stamp>.json.gz (new names each run, so a client reading yesterday's manifest
 * never gets half of today's files), <out>/jobs-manifest.json (upload it last) and <out>/stats.json;
 * and the second format, a full copy plus a daily change file (lib/feed-v2.ts).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { getConnector, HttpClient, jobCompanyKey, JOB_FEED_SCHEMA, NotModifiedError, type CompanyRef, type FeedRow, type HttpCache, type JobFeedManifest, type JobFeedShard } from "@rawjobs/core";
import { readDenylist } from "./lib/denylist";
import { stateOf, writeFeedV2 } from "./lib/feed-v2";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DIRECTORY = resolve(arg("--directory") ?? join(here, "out", "directory.json"));
const OUT = resolve(arg("--out") ?? join(here, "out", "jobs"));
const ATS = (arg("--ats") ?? "greenhouse,lever,ashby,smartrecruiters,workday").split(",");
const DEADLINE = Date.now() + Number(arg("--max-minutes") ?? 300) * 60_000;
/** Companies in flight per hiring system: shared API hosts just queue (HttpClient paces each host). */
const WORKERS: Record<string, number> = { workday: 16 };
/** Feeds that are one request per board, so a 304 means nothing changed. */
const ETAG_HOSTS = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.eu.lever.co", "api.ashbyhq.com"]);
/** Entries not refreshed for this long are dropped. */
const DROP_AFTER_DAYS = 7;
/** A day-over-day change this large in jobs or companies is flagged for a look. */
const ALERT_CHANGE = 0.2;

type Entry = { key: string; name: string; ats: string; slug: string; region?: string; shard?: string; site?: string; status: string; careers_url?: string };

/** Keeps only ETags: on a 304 the client throws NotModifiedError and yesterday's rows are reused. */
class EtagStore implements HttpCache {
  readonly etags: Record<string, string>;
  constructor(file: string) {
    this.etags = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
  }
  get(url: string) {
    const etag = this.etags[url];
    return etag && ETAG_HOSTS.has(new URL(url).host) ? { etag } : undefined;
  }
  set(url: string, etag: string) {
    if (ETAG_HOSTS.has(new URL(url).host)) this.etags[url] = etag;
  }
}

const readShard = (manifest: JobFeedManifest | undefined, ats: string): JobFeedShard | undefined => {
  const name = manifest?.shards[ats]?.file;
  try {
    return name && existsSync(join(OUT, name)) ? (JSON.parse(gunzipSync(readFileSync(join(OUT, name))).toString("utf8")) as JobFeedShard) : undefined;
  } catch {
    return undefined;
  }
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const denied = readDenylist();
  const directory = (JSON.parse(readFileSync(DIRECTORY, "utf8")) as { companies: Entry[] }).companies;
  const etags = new EtagStore(join(OUT, "etags.json"));
  const http = new HttpClient({
    cache: etags,
    timeoutMs: 20_000,
    retries: 2,
    backoffMs: 3_000,
    breakAfter: 8,
    userAgent: "RawJobs-feed/0.1 (open-source job radar; one daily read per board; https://github.com/Tanmay-Mhatre/rawjobs)",
  });
  const previousManifest = existsSync(join(OUT, "jobs-manifest.json")) ? (JSON.parse(readFileSync(join(OUT, "jobs-manifest.json"), "utf8")) as JobFeedManifest) : undefined;
  const now = new Date();
  const generated = now.toISOString();
  const stamp = generated.replace(/[-:]/g, "").slice(0, 13);
  const manifest: JobFeedManifest = { schema: JOB_FEED_SCHEMA, generated_at: generated, shards: {} };
  const stats: Record<string, { companies: number; jobs: number; fetched: number; notModified: number; failed: number; kept: number; skipped: number }> = {};
  /** Every hiring system's companies, for the second format. */
  const everyone: JobFeedShard["companies"] = {};

  await Promise.all(
    ATS.map(async (ats) => {
      const connector = getConnector(ats as CompanyRef["ats"]);
      if (!connector) throw new Error(`no connector for ${ats}`);
      const previous = readShard(previousManifest, ats)?.companies ?? {};
      const companies: JobFeedShard["companies"] = {};
      const s = (stats[ats] = { companies: 0, jobs: 0, fetched: 0, notModified: 0, failed: 0, kept: 0, skipped: 0 });
      const seen = new Set<string>();
      const todo = directory.filter((e) => {
        if (e.ats !== ats || e.status !== "live" || denied(e)) return false;
        const key = jobCompanyKey(e);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const keep = (key: string) => {
        const p = previous[key];
        if (p && now.getTime() - Date.parse(p.fetched_at) <= DROP_AFTER_DAYS * 86_400_000) {
          companies[key] = p;
          s.kept++;
        }
      };
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const e = todo[next++]!;
          const key = jobCompanyKey(e);
          if (Date.now() > DEADLINE) {
            s.skipped++;
            keep(key);
            continue;
          }
          const ref = { name: e.name, ats: e.ats, slug: e.slug, region: e.region, shard: e.shard, site: e.site, enabled: true } as CompanyRef;
          try {
            const raws = await connector.fetch(ref, { http, now });
            const rows: FeedRow[] = raws.map((r) => {
              const j = connector.normalize(r, ref);
              return [j.id.slice(key.length + 1), j.title, j.location, j.workplace, j.postedAt ? j.postedAt.slice(0, 10) : null];
            });
            companies[key] = { fetched_at: generated, jobs: rows };
            s.fetched++;
          } catch (err) {
            if (err instanceof NotModifiedError && previous[key]) {
              companies[key] = { ...previous[key]!, fetched_at: generated };
              s.notModified++;
            } else {
              s.failed++;
              keep(key);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(WORKERS[ats] ?? 4, todo.length || 1) }, worker));

      Object.assign(everyone, companies);
      const shard: JobFeedShard = { schema: JOB_FEED_SCHEMA, ats, generated_at: generated, companies };
      const gz = gzipSync(JSON.stringify(shard), { level: 9 });
      const file = `jobs-${ats}-${stamp}.json.gz`;
      writeFileSync(join(OUT, file), gz);
      s.companies = Object.keys(companies).length;
      s.jobs = Object.values(companies).reduce((n, c) => n + c.jobs.length, 0);
      manifest.shards[ats] = { file, sha256: createHash("sha256").update(gz).digest("hex"), bytes: gz.length, companies: s.companies, jobs: s.jobs };
      console.error(`${ats}: ${s.companies} companies, ${s.jobs} jobs (${s.fetched} fetched, ${s.notModified} unchanged, ${s.failed} failed, ${s.skipped} out of time)`);
    }),
  );

  // Flag big swings (a broken connector, a blocked host) for a person to look at.
  const total = (m: JobFeedManifest | undefined, f: "jobs" | "companies") => Object.values(m?.shards ?? {}).reduce((n, x) => n + x[f], 0);
  const alerts: string[] = [];
  if (previousManifest) {
    for (const f of ["jobs", "companies"] as const) {
      const before = total(previousManifest, f);
      const after = total(manifest, f);
      if (before > 0 && Math.abs(after - before) / before > ALERT_CHANGE) alerts.push(`${f}: ${before} -> ${after}`);
    }
  }
  writeFileSync(join(OUT, "etags.json"), JSON.stringify(etags.etags));
  const current = new Set(Object.values(manifest.shards).map((x) => x.file));
  for (const f of readdirSync(OUT)) if (/^jobs-.+\.json\.gz$/.test(f) && !current.has(f)) rmSync(join(OUT, f));
  writeFileSync(join(OUT, "jobs-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // The second format: a full copy plus today's change file (see lib/feed-v2.ts).
  const v2 = writeFeedV2(OUT, stateOf(everyone), generated);
  const mb = (n: number) => (n / 1e6).toFixed(2);
  console.error(
    `v2: #${v2.seq}, full copy ${mb(v2.snapshotBytes)} MB${v2.diffBytes !== undefined ? `, change file ${mb(v2.diffBytes)} MB (${v2.changedCompanies} companies)` : ""}${v2.note ? ` (${v2.note})` : ""}`,
  );
  writeFileSync(join(OUT, "stats.json"), `${JSON.stringify({ generated_at: generated, http: http.stats, ats: stats, alerts, v2 }, null, 2)}\n`);
  console.error(`Feed: ${total(manifest, "companies")} companies, ${total(manifest, "jobs")} jobs; ${http.stats.requests} requests, ${http.stats.notModified} unchanged.`);
  if (alerts.length) console.error(`Large change since yesterday: ${alerts.join("; ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
