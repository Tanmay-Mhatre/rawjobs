/**
 * The shared job feed (packages/core/src/job-feed.ts): every live directory board's open jobs as slim
 * rows, rebuilt every 6 hours by the "Jobs · feed" workflow. Scans use it to skip companies with nothing
 * for a user; they still fetch the rest live.
 *
 *   pnpm exec tsx scripts/catalog/jobs.ts crawl --group sr|payroll|enterprise|rest [--generated ISO]
 *     [--directory out/directory.json] [--out out/jobs] [--max-minutes 240]
 *   pnpm exec tsx scripts/catalog/jobs.ts merge [--generated ISO] [--out out/jobs]
 *   pnpm exec tsx scripts/catalog/jobs.ts [--ats greenhouse,lever]   every group, then merge (local runs)
 *
 * crawl: one group of hiring systems (GROUPS), in parallel with the others on CI. Writes
 *   <out>/groups/<group>/: jobs-<ats>-<stamp>.json.gz (one shard per system), group.json, etags.json.
 *   Unchanged boards cost an empty 304 (ETags, for the one-request feeds). A board that fails, or that
 *   the time limit leaves out, keeps its previous rows and time: clients fetch stale ones live.
 * merge: every group's shards (a group that failed: its previous saved copy) into the published files:
 *   the first format (jobs-manifest.json + shards, the five original systems only), the second
 *   (jobs-v2-*, the same five) and the third (jobs-v3-*, every system); see lib/feed-v2.ts. Plus stats.json
 *   with per-system numbers and alerts. Upload manifests last.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  connectors,
  HOST_DELAYS,
  HttpClient,
  JOB_BOARDS,
  jobCompanyKey,
  JOB_FEED_SCHEMA,
  NotModifiedError,
  refOfEntry,
  type CompanyRef,
  type DirectoryEntry,
  type FeedRow,
  type HttpCache,
  type JobFeedManifest,
  type JobFeedShard,
} from "@rawjobs/core";
import { readDenylist } from "./lib/denylist";
import { readFeed, stateOf, writeFeed } from "./lib/feed-v2";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Every hiring system with a connector (job boards aren't in the directory). */
export const FEED_ATS = Object.keys(connectors).filter((a) => !(JOB_BOARDS as readonly string[]).includes(a));
/** The first and second formats stay as apps from before the third know them: these five systems. */
export const ORIGINAL_ATS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday"];
/** CI runs one job per group, so the slow shared APIs don't hold each other up. "rest": every other system. */
export const GROUPS: Record<string, string[]> = {
  sr: ["smartrecruiters"],
  payroll: ["paylocity", "paycom", "hireology", "workable"],
  enterprise: ["workday", "icims", "oracle", "successfactors", "taleo", "phenom", "eightfold"],
  rest: [],
};
export const atsOfGroup = (group: string): string[] => {
  const named = new Set(Object.values(GROUPS).flat());
  return group === "rest" ? FEED_ATS.filter((a) => !named.has(a)) : (GROUPS[group] ?? []).filter((a) => FEED_ATS.includes(a));
};

/** Companies in flight per hiring system: shared API hosts just queue (HttpClient paces each host). */
const WORKERS: Record<string, number> = { workday: 20, icims: 10, successfactors: 8 };
/**
 * The feed's pace per shared API host, faster than the app's own (HOST_DELAYS): one read per board per
 * run, from CI only. Any 429 still slows a host down for the rest of the run.
 */
const CI_HOST_DELAYS: Record<string, number> = {
  ...HOST_DELAYS,
  "api.smartrecruiters.com": 500,
  "recruiting.paylocity.com": 550,
  "www.paycomonline.net": 667,
};
/** Feeds that are one request per board, so a 304 means nothing changed. */
const ETAG_HOSTS = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.eu.lever.co", "api.ashbyhq.com"]);
/** Entries not refreshed for this long are dropped. */
const DROP_AFTER_DAYS = 7;
/** A run-over-run change this large in a system's jobs (or all jobs or companies) is flagged for a look. */
const ALERT_CHANGE = 0.2;
/** A system whose boards fail this often (of at least ALERT_MIN tried) is flagged. */
const ALERT_FAILED = 0.3;
const ALERT_MIN = 20;
/** This many failed boards in a row stops a system for the run (a blocked runner, across all its hosts). */
const BREAK_ATS_AFTER = 100;
/** Vague-location jobs ("3 Locations") looked up per company per run; the rest wait for the next run. */
const DESCRIBES_PER_COMPANY = 25;

type Entry = DirectoryEntry & { key: string; status: string };
type AtsStats = {
  companies: number;
  jobs: number;
  fetched: number;
  notModified: number;
  failed: number;
  kept: number;
  skipped: number;
  partial: number;
  described: number;
  badRows: number;
  tripped: boolean;
  seconds: number;
};
type GroupFile = { group: string; generated_at: string; seconds: number; shards: JobFeedManifest["shards"]; stats: Record<string, AtsStats>; http: HttpClient["stats"] };

/** Keeps only ETags: on a 304 the client throws NotModifiedError and the previous rows are reused. */
class EtagStore implements HttpCache {
  readonly etags: Record<string, string>;
  constructor(...files: string[]) {
    const file = files.find((f) => existsSync(f));
    this.etags = file ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
  }
  get(url: string) {
    const etag = this.etags[url];
    return etag && ETAG_HOSTS.has(new URL(url).host) ? { etag } : undefined;
  }
  set(url: string, etag: string) {
    if (ETAG_HOSTS.has(new URL(url).host)) this.etags[url] = etag;
  }
}

const readJson = <T>(file: string): T | undefined => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
};

const readShard = (dir: string, shards: JobFeedManifest["shards"] | undefined, ats: string): JobFeedShard | undefined => {
  const name = shards?.[ats]?.file;
  try {
    return name && existsSync(join(dir, name)) ? (JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString("utf8")) as JobFeedShard) : undefined;
  } catch {
    return undefined;
  }
};

const writeShard = (dir: string, ats: string, stamp: string, shard: JobFeedShard) => {
  const gz = gzipSync(JSON.stringify(shard), { level: 9 });
  const file = `jobs-${ats}-${stamp}.json.gz`;
  writeFileSync(join(dir, file), gz);
  const companies = Object.keys(shard.companies).length;
  const jobs = Object.values(shard.companies).reduce((n, c) => n + c.jobs.length, 0);
  return { file, sha256: createHash("sha256").update(gz).digest("hex"), bytes: gz.length, companies, jobs };
};

const stampOf = (generated: string) => generated.replace(/[-:]/g, "").slice(0, 13);

/** Read one group's hiring systems into <out>/groups/<group>. */
async function crawl(out: string, group: string, generated: string, directoryFile: string, deadline: number, only?: string[]) {
  const dir = join(out, "groups", group);
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const atses = only ?? atsOfGroup(group);
  const denied = readDenylist();
  const directory = (JSON.parse(readFileSync(directoryFile, "utf8")) as { companies: Entry[] }).companies;
  // The group's own saved copy; before the first one, the single-job feed's (the first format, in <out>).
  const previousGroup = readJson<GroupFile>(join(dir, "group.json"));
  const legacy = previousGroup ? undefined : readJson<JobFeedManifest>(join(out, "jobs-manifest.json"));
  const etags = new EtagStore(join(dir, "etags.json"), join(out, "etags.json"));
  const http = new HttpClient({
    cache: etags,
    timeoutMs: 20_000,
    retries: 2,
    backoffMs: 3_000,
    breakAfter: 8,
    hostDelays: CI_HOST_DELAYS,
    userAgent: "RawJobs-feed/0.2 (open-source job radar; one read per board every 6 hours; https://github.com/Tanmay-Mhatre/rawjobs)",
  });
  const now = new Date(generated);
  const stamp = stampOf(generated);
  const result: GroupFile = { group, generated_at: generated, seconds: 0, shards: {}, stats: {}, http: http.stats };

  await Promise.all(
    atses.map(async (ats) => {
      const t0 = Date.now();
      const connector = connectors[ats as CompanyRef["ats"]];
      const s: AtsStats = (result.stats[ats] = { companies: 0, jobs: 0, fetched: 0, notModified: 0, failed: 0, kept: 0, skipped: 0, partial: 0, described: 0, badRows: 0, tripped: false, seconds: 0 });
      if (!connector) return;
      const previous = (previousGroup ? readShard(dir, previousGroup.shards, ats) : readShard(out, legacy?.shards, ats))?.companies ?? {};
      const companies: JobFeedShard["companies"] = {};
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
      let streak = 0;
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const e = todo[next++]!;
          const key = jobCompanyKey(e);
          if (Date.now() > deadline || s.tripped) {
            s.skipped++;
            keep(key);
            continue;
          }
          // refOfEntry keeps careers_url, which SuccessFactors boards need.
          const ref = refOfEntry(e);
          let partial = false;
          try {
            const raws = await connector.fetch(ref, { http, now, partial: () => (partial = true) });
            const before = new Map((previous[key]?.jobs ?? []).map((r) => [r[0], r]));
            let describes = 0;
            const rows: FeedRow[] = [];
            for (const raw of raws) {
              let j: ReturnType<typeof connector.normalize>;
              try {
                j = connector.normalize(raw, ref);
              } catch {
                // One malformed posting (Workday lists some without a path) mustn't cost the whole board.
                s.badRows++;
                continue;
              }
              const id = j.id.slice(key.length + 1);
              const was = before.get(id);
              // The earlier posted date: relative dates ("30+ Days Ago") would otherwise move every run.
              let posted = j.postedAt ? j.postedAt.slice(0, 10) : null;
              if (was?.[4] && (!posted || was[4] < posted)) posted = was[4];
              const row: FeedRow = [id, j.title, j.location, j.workplace, posted];
              // "3 Locations": look up where once per job id, and carry it from run to run.
              if (connector.vagueLocation?.(raw) && connector.describe) {
                let resolved = was && was[2] === j.location ? was[5] : undefined;
                if (resolved === undefined && describes < DESCRIBES_PER_COMPANY && Date.now() < deadline) {
                  describes++;
                  try {
                    const d = await connector.describe(raw, ref, { http, now });
                    if (typeof d !== "string" && d.location) resolved = d.location;
                    s.described++;
                  } catch {
                    // Next run.
                  }
                }
                if (resolved !== undefined) row.push(resolved);
              }
              rows.push(row);
            }
            companies[key] = { fetched_at: generated, jobs: rows, ...(partial ? { partial: true } : {}) };
            if (partial) s.partial++;
            s.fetched++;
            streak = 0;
          } catch (err) {
            if (err instanceof NotModifiedError && previous[key]) {
              companies[key] = { ...previous[key]!, fetched_at: generated };
              s.notModified++;
              streak = 0;
            } else {
              s.failed++;
              if (process.env.FEED_DEBUG) console.error(`${key}: ${(err as Error).message}`);
              keep(key);
              // A blocked runner fails every board of a system, across all its hosts: stop asking.
              if (++streak >= BREAK_ATS_AFTER) s.tripped = true;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(WORKERS[ats] ?? 4, todo.length || 1) }, worker));
      result.shards[ats] = writeShard(dir, ats, stamp, { schema: JOB_FEED_SCHEMA, ats, generated_at: generated, companies });
      s.companies = result.shards[ats]!.companies;
      s.jobs = result.shards[ats]!.jobs;
      s.seconds = Math.round((Date.now() - t0) / 1000);
      console.error(
        `${ats}: ${s.companies} companies, ${s.jobs} jobs (${s.fetched} fetched, ${s.notModified} unchanged, ${s.failed} failed, ${s.skipped} skipped${s.tripped ? " after too many failures in a row" : ""}, ${s.partial} capped, ${s.described} places looked up, ${s.badRows} malformed postings) in ${s.seconds} s`,
      );
    }),
  );
  result.seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(dir, "etags.json"), JSON.stringify(etags.etags));
  const current = new Set(Object.values(result.shards).map((x) => x.file));
  for (const f of readdirSync(dir)) if (/^jobs-.+\.json\.gz$/.test(f) && !current.has(f)) rmSync(join(dir, f));
  writeFileSync(join(dir, "group.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Group ${group}: ${result.seconds} s, ${http.stats.requests} requests, ${http.stats.notModified} unchanged.`);
}

export type Alert = { ats?: string; text: string };

/** Every group's shards into the published files. */
function merge(out: string, generated: string) {
  const previousManifest = readJson<JobFeedManifest>(join(out, "jobs-manifest.json"));
  const previousStats = readJson<{ ats_jobs?: Record<string, number> }>(join(out, "stats.json"));
  const stamp = stampOf(generated);
  const everyone: JobFeedShard["companies"] = {};
  const byAts: Record<string, JobFeedShard["companies"]> = {};
  const stats: Record<string, AtsStats & { group: string; fresh: boolean }> = {};
  const groups: Record<string, { generated_at?: string; seconds?: number; fresh: boolean; http?: GroupFile["http"] }> = {};
  const alerts: Alert[] = [];
  for (const group of Object.keys(GROUPS)) {
    const dir = join(out, "groups", group);
    const g = readJson<GroupFile>(join(dir, "group.json"));
    const fresh = g?.generated_at === generated;
    groups[group] = { generated_at: g?.generated_at, seconds: g?.seconds, fresh, http: g?.http };
    if (!fresh) alerts.push({ text: `group ${group} didn't finish this run; ${g ? `kept its copy from ${g.generated_at}` : "no saved copy, so its systems are left out"}` });
    for (const ats of Object.keys(g?.shards ?? {})) {
      const shard = readShard(dir, g!.shards, ats);
      if (!shard) continue;
      byAts[ats] = shard.companies;
      Object.assign(everyone, shard.companies);
      stats[ats] = { ...g!.stats[ats]!, group, fresh };
    }
  }

  // Per system: a stop, many failures or a big swing in jobs usually means a broken connector or a blocked runner.
  const atsJobs: Record<string, number> = {};
  for (const [ats, companies] of Object.entries(byAts)) atsJobs[ats] = Object.values(companies).reduce((n, c) => n + c.jobs.length, 0);
  for (const [ats, s] of Object.entries(stats)) {
    if (!s.fresh) continue;
    const tried = s.fetched + s.notModified + s.failed;
    if (s.tripped) alerts.push({ ats, text: `${ats}: stopped after ${BREAK_ATS_AFTER} failed boards in a row (${s.failed} failed, ${s.skipped} skipped); a host may be blocking the runner` });
    else if (tried >= ALERT_MIN && s.failed / tried > ALERT_FAILED) alerts.push({ ats, text: `${ats}: ${Math.round((100 * s.failed) / tried)}% of ${tried} boards failed` });
    const before = previousStats?.ats_jobs?.[ats];
    const after = atsJobs[ats] ?? 0;
    if (before && before >= 100 && Math.abs(after - before) / before > ALERT_CHANGE) alerts.push({ ats, text: `${ats}: jobs ${before} -> ${after}` });
  }

  // The first format: the original five systems, as before (five columns, no capped flag).
  const manifest: JobFeedManifest = { schema: JOB_FEED_SCHEMA, generated_at: generated, shards: {} };
  for (const ats of ORIGINAL_ATS) {
    const companies = byAts[ats];
    if (!companies) {
      // A system no group has: keep its previous shard rather than drop it from older apps.
      const prev = previousManifest?.shards[ats];
      if (prev && existsSync(join(out, prev.file))) manifest.shards[ats] = prev;
      continue;
    }
    const slim: JobFeedShard["companies"] = {};
    for (const [key, c] of Object.entries(companies)) slim[key] = { fetched_at: c.fetched_at, jobs: c.jobs.map((r) => r.slice(0, 5) as FeedRow) };
    manifest.shards[ats] = writeShard(out, ats, stamp, { schema: JOB_FEED_SCHEMA, ats, generated_at: generated, companies: slim });
  }
  const total = (m: JobFeedManifest | undefined, f: "jobs" | "companies") => Object.values(m?.shards ?? {}).reduce((n, x) => n + x[f], 0);
  if (previousManifest) {
    for (const f of ["jobs", "companies"] as const) {
      const before = total(previousManifest, f);
      const after = total(manifest, f);
      if (before > 0 && Math.abs(after - before) / before > ALERT_CHANGE) alerts.push({ text: `first format ${f}: ${before} -> ${after}` });
    }
  }
  // The previous run's shards stay published one more run: an app may be part-way through downloading them.
  const current = new Set(Object.values(manifest.shards).map((x) => x.file));
  const v1Previous = Object.values(previousManifest?.shards ?? {})
    .map((x) => x.file)
    .filter((f) => !current.has(f));
  for (const f of readdirSync(out)) if (/^jobs-.+\.json\.gz$/.test(f) && !current.has(f)) rmSync(join(out, f));
  writeFileSync(join(out, "jobs-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // A system no group has (its group never ran): keep its rows from the previous full copy while fresh enough.
  const previousV3 = readFeed(out, 3)?.state;
  const missing = FEED_ATS.filter((a) => !byAts[a]);
  if (previousV3 && missing.length) {
    const cutoff = Date.parse(generated) - DROP_AFTER_DAYS * 86_400_000;
    const partial = new Set(previousV3.partial ?? []);
    for (const [key, rows] of Object.entries(previousV3.jobs)) {
      if (!missing.some((a) => key.startsWith(`${a}:`)) || !(Date.parse(previousV3.verified[key] ?? "") >= cutoff)) continue;
      everyone[key] = { fetched_at: previousV3.verified[key]!, jobs: rows, ...(partial.has(key) ? { partial: true } : {}) };
    }
  }

  const original = Object.fromEntries(Object.entries(everyone).filter(([key]) => ORIGINAL_ATS.some((a) => key.startsWith(`${a}:`))));
  const v2 = writeFeed(out, stateOf(original, 2), generated, 2);
  const v3 = writeFeed(out, stateOf(everyone, 3), generated, 3);
  const mb = (n: number) => (n / 1e6).toFixed(2);
  for (const [name, v] of [
    ["v2", v2],
    ["v3", v3],
  ] as const)
    console.error(
      `${name}: #${v.seq}, full copy ${mb(v.snapshotBytes)} MB${v.diffBytes !== undefined ? `, change file ${mb(v.diffBytes)} MB (${v.changedCompanies} companies)` : ""}${v.note ? ` (${v.note})` : ""}`,
    );
  writeFileSync(join(out, "stats.json"), `${JSON.stringify({ generated_at: generated, groups, ats: stats, ats_jobs: atsJobs, alerts, v1: { previous: v1Previous }, v2, v3 }, null, 2)}\n`);
  console.error(`Feed: ${Object.keys(everyone).length} companies, ${Object.values(atsJobs).reduce((a, b) => a + b, 0)} jobs.`);
  for (const a of alerts) console.error(`Alert: ${a.text}`);
}

async function main() {
  const out = resolve(arg("--out") ?? join(here, "out", "jobs"));
  mkdirSync(out, { recursive: true });
  const generated = new Date(arg("--generated") ?? Date.now()).toISOString();
  const deadline = Date.now() + Number(arg("--max-minutes") ?? 240) * 60_000;
  const directory = resolve(arg("--directory") ?? join(here, "out", "directory.json"));
  const command = process.argv[2];
  if (command === "crawl") {
    const group = arg("--group") ?? "";
    if (!(group in GROUPS)) throw new Error(`--group must be one of ${Object.keys(GROUPS).join(", ")}`);
    await crawl(out, group, generated, directory, deadline);
  } else if (command === "merge") {
    merge(out, generated);
  } else {
    // Everything in one go (local runs): --ats narrows it to some systems.
    const only = arg("--ats")?.split(",");
    for (const a of only ?? []) if (!FEED_ATS.includes(a)) console.error(`${a}: no connector; skipped.`);
    await Promise.all(
      Object.keys(GROUPS).map((group) => {
        const atses = atsOfGroup(group).filter((a) => !only || only.includes(a));
        return atses.length ? crawl(out, group, generated, directory, deadline, atses) : undefined;
      }),
    );
    merge(out, generated);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
