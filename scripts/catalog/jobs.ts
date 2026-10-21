/**
 * The shared job feed (packages/core/src/job-feed.ts): every live directory board's open jobs as slim
 * rows, rebuilt every 6 hours by the "Jobs · feed" workflow. Scans use it to skip companies with nothing
 * for a user; they still fetch the rest live.
 *
 *   pnpm exec tsx scripts/catalog/jobs.ts crawl --group sr|payroll|enterprise|join|rest [--generated ISO]
 *     [--directory out/directory.json] [--out out/jobs] [--max-minutes 240]
 *   pnpm exec tsx scripts/catalog/jobs.ts merge [--generated ISO] [--out out/jobs]
 *   pnpm exec tsx scripts/catalog/jobs.ts [--ats greenhouse,lever]   every group, then merge (local runs)
 *
 * crawl: one group of hiring systems (GROUPS), in parallel with the others on CI. Writes
 *   <out>/groups/<group>/: jobs-<ats>-<stamp>.json.gz (one shard per system), group.json, etags.json,
 *   board-ids.json. Unchanged boards cost an empty 304 (ETags: the one-request feeds, and JOIN's first
 *   page). A board that fails, or that the time limit leaves out, keeps its previous rows and time:
 *   clients fetch stale ones live.
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
  FileBoardIds,
  HOST_DELAYS,
  HttpClient,
  JOB_BOARDS,
  jobCompanyKey,
  JOB_FEED_SCHEMA,
  HttpError,
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
  enterprise: ["workday", "icims", "oracle", "successfactors", "taleo", "phenom", "eightfold", "avature", "radancy"],
  // ~13,000 small boards on one host: in "rest" it used the whole time limit and left half unread.
  join: ["join"],
  rest: [],
};
export const atsOfGroup = (group: string): string[] => {
  const named = new Set(Object.values(GROUPS).flat());
  return group === "rest" ? FEED_ATS.filter((a) => !named.has(a)) : (GROUPS[group] ?? []).filter((a) => FEED_ATS.includes(a));
};

/**
 * Companies in flight per hiring system: shared API hosts just queue (HttpClient paces each host).
 * Eightfold one at a time: its CDN refuses a CI runner's whole IP past about a request a second overall.
 */
const WORKERS: Record<string, number> = { workday: 20, icims: 10, successfactors: 8, join: 6, eightfold: 1 };
/** Groups whose shared APIs are paced adaptively (see the HttpClient in crawl). */
const ADAPTIVE_GROUPS = new Set(["join", "payroll"]);
/**
 * The feed's pace per shared API host, faster than the app's own (HOST_DELAYS): one read per board per
 * run, from CI only. Any 429 still slows a host down for the rest of the run. In ADAPTIVE_GROUPS a host
 * with a shared pace (paceOf) ignores its gap here; the gap applies again if the group stops being adaptive.
 */
const CI_HOST_DELAYS: Record<string, number> = {
  ...HOST_DELAYS,
  "api.smartrecruiters.com": 500,
  "recruiting.paylocity.com": 550,
  "www.paycomonline.net": 667,
};
/**
 * Hiring systems whose every board is its own host, with the gap the feed keeps on each. Eightfold's CDN
 * (CloudFront) refuses (403) a CI runner's IP for every board after a few minutes at ~1.6 requests a second
 * across boards; with one board in flight (WORKERS), 1.25 s keeps it at ~0.8. Home connections aren't refused.
 */
const CI_BOARD_GAPS: Record<string, number> = { eightfold: 1_250 };

/** The gap per board host for CI_BOARD_GAPS' systems, from the directory (slug = host, own hosts included). */
export function slowHosts(directory: { ats: string; slug: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of directory) {
    const gap = CI_BOARD_GAPS[e.ats];
    if (gap) out[e.slug.toLowerCase()] = gap;
  }
  return out;
}
/** Feeds that are one request per board, so a 304 means nothing changed. */
const ETAG_HOSTS = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.eu.lever.co", "api.ashbyhq.com"]);
/**
 * JOIN's first page carries the board's total and its newest jobs: the same page means the same board.
 * Later pages aren't sent an ETag (a 304 there would stand for the whole board).
 */
const etagFor = (url: string) => {
  const u = new URL(url);
  return ETAG_HOSTS.has(u.host) || (u.host === "join.com" && u.pathname.endsWith("/jobs") && u.searchParams.get("page") === "1");
};
/** Entries not refreshed for this long are dropped. */
const DROP_AFTER_DAYS = 7;
/** A run-over-run change this large in the jobs of the same companies (or a fall this large in companies) is flagged. */
const ALERT_CHANGE = 0.2;
/** A system whose boards fail this often (of at least ALERT_MIN tried) is flagged. */
const ALERT_FAILED = 0.3;
const ALERT_MIN = 20;
/** This many failed boards in a row stops a system for the run (a blocked runner, across all its hosts). */
const BREAK_ATS_AFTER = 100;
/** Failed boards printed per system and reason in the run log. */
const FAIL_EXAMPLES = 3;
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
  /** Failed boards by reason ("HTTP 429", "timeout"), so an alert says what went wrong. */
  reasons?: Record<string, number>;
  /** Jobs before and after of the companies in both runs: a growing directory alone moves no alert. */
  same?: { before: number; after: number };
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
    return etag && etagFor(url) ? { etag } : undefined;
  }
  set(url: string, etag: string) {
    if (etagFor(url)) this.etags[url] = etag;
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
  // JOIN's company numbers, read off careers pages once (board-ids.ts).
  const ids = new FileBoardIds(join(dir, "board-ids.json"));
  const http = new HttpClient({
    cache: etags,
    timeoutMs: 20_000,
    retries: 2,
    backoffMs: 3_000,
    breakAfter: 8,
    hostDelays: { ...CI_HOST_DELAYS, ...slowHosts(directory) },
    // These groups are paced like the app paces them (http.ts paceOf: each API up to its ceiling, halved on
    // a 429 and back up after). A fixed gap that a 429 doubles stays doubled for the run: two early 429s
    // left JOIN at 1.2 s for 4 h. Payroll's slowest host, Paycom's API, had no gap of its own (1 s default).
    adaptive: ADAPTIVE_GROUPS.has(group),
    // After a halving, hold for a minute: an hour at the ceiling from one IP must not keep re-testing a limit.
    climbHoldMs: 60_000,
    // Workable at the app's 3/s drew 104 × 429 and 67 slow-downs in an hour from CI (test run 39659100795);
    // at a fixed 1/s it drew none.
    paceCeilings: { workable: 2 },
    // A paced API that fails 8 times in a row rests and is tried again, instead of every one of its boards
    // keeping stale rows for the rest of the run.
    hostRests: ADAPTIVE_GROUPS.has(group),
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
            const raws = await connector.fetch(ref, { http, now, ids, partial: () => (partial = true) });
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
              const reason = failReason(err);
              const reasons = (s.reasons ??= {});
              reasons[reason] = (reasons[reason] ?? 0) + 1;
              // A few examples per reason in the run log; all of them with FEED_DEBUG.
              if (process.env.FEED_DEBUG || reasons[reason] <= FAIL_EXAMPLES)
                console.error(`${ats} failed: ${key}: ${(err as Error).message}${err instanceof HttpError && err.detail ? ` [${err.detail}]` : ""}`);
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
      s.same = sameJobs(previous, companies);
      console.error(
        `${ats}: ${s.companies} companies, ${s.jobs} jobs (${s.fetched} fetched, ${s.notModified} unchanged, ${s.failed} failed${s.failed ? ` [${describeReasons(s.reasons)}]` : ""}, ${s.skipped} skipped${s.tripped ? " after too many failures in a row" : ""}, ${s.partial} partial, ${s.described} places looked up, ${s.badRows} malformed postings) in ${s.seconds} s`,
      );
    }),
  );
  result.seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(dir, "etags.json"), JSON.stringify(etags.etags));
  ids.save();
  const current = new Set(Object.values(result.shards).map((x) => x.file));
  for (const f of readdirSync(dir)) if (/^jobs-.+\.json\.gz$/.test(f) && !current.has(f)) rmSync(join(dir, f));
  writeFileSync(join(dir, "group.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Group ${group}: ${result.seconds} s, ${http.stats.requests} requests, ${http.stats.notModified} unchanged.`);
}

export type Alert = { ats?: string; text: string };

/** Why a board failed, grouped across boards: "HTTP 429", "timeout", or the message without its URLs and names. */
export function failReason(err: unknown): string {
  if (err instanceof HttpError && err.status) return `HTTP ${err.status}`;
  const message = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(message)) return "timeout";
  return (
    message
      .replace(/\s*\(https?:\/\/[^)]*\)/g, "")
      .replace(/https?:\/\/\S+/g, "<url>")
      .replace(/"[^"]*"/g, '"…"')
      .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi, "<host>")
      .replace(/\d+/g, "N")
      .slice(0, 80) || "unknown"
  );
}

/** "HTTP 429 ×600, timeout ×259": most common first. */
export function describeReasons(reasons: Record<string, number> | undefined, max = 3): string {
  const sorted = Object.entries(reasons ?? {}).sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, max).map(([r, n]) => `${r} ×${n}`);
  if (sorted.length > max) shown.push(`${sorted.length - max} more`);
  return shown.join(", ");
}

/** Jobs before and after of the companies in both runs, leaving out partial boards (capped, or refused partway). */
export function sameJobs(previous: JobFeedShard["companies"], current: JobFeedShard["companies"]): { before: number; after: number } {
  const same = { before: 0, after: 0 };
  for (const [key, c] of Object.entries(current)) {
    const p = previous[key];
    if (!p || c.partial) continue;
    same.before += p.jobs.length;
    same.after += c.jobs.length;
  }
  return same;
}

/** A swing in the jobs of the companies in both runs, or undefined when it's small (or too few jobs to tell). */
export function sameSwing(same: { before: number; after: number } | undefined): string | undefined {
  if (!same || same.before < 100 || Math.abs(same.after - same.before) / same.before <= ALERT_CHANGE) return undefined;
  return `jobs at the same companies ${same.before} -> ${same.after}`;
}

/**
 * How much of the feed this run read: companies in it against the previous feed, and how many were read
 * (or confirmed unchanged) this run rather than kept from an earlier one. The proof that a speed-up
 * dropped no company.
 */
export function feedCoverage(companies: JobFeedShard["companies"], previous: number | undefined, generated: string) {
  const all = Object.values(companies);
  const thisRun = all.filter((c) => c.fetched_at === generated).length;
  return { companies: all.length, previous: previous ?? null, this_run: thisRun, kept: all.length - thisRun, jobs: all.reduce((n, c) => n + c.jobs.length, 0) };
}

/** Every group's shards into the published files. */
function merge(out: string, generated: string) {
  const previousManifest = readJson<JobFeedManifest>(join(out, "jobs-manifest.json"));
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
    const why = s.reasons ? ` (${describeReasons(s.reasons)})` : "";
    if (s.tripped) alerts.push({ ats, text: `${ats}: stopped after ${BREAK_ATS_AFTER} failed boards in a row (${s.failed} failed, ${s.skipped} skipped)${why}; a host may be blocking the runner` });
    else if (tried >= ALERT_MIN && s.failed / tried > ALERT_FAILED) alerts.push({ ats, text: `${ats}: ${Math.round((100 * s.failed) / tried)}% of ${tried} boards failed${why}` });
    const swing = sameSwing(s.same);
    if (swing) alerts.push({ ats, text: `${ats}: ${swing}` });
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
  // Its jobs are watched per system above. More companies is the directory growing; far fewer means boards dropped.
  if (previousManifest) {
    const before = total(previousManifest, "companies");
    const after = total(manifest, "companies");
    if (before > 0 && (before - after) / before > ALERT_CHANGE) alerts.push({ text: `first format companies: ${before} -> ${after}` });
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
  const coverage = feedCoverage(everyone, previousV3 ? Object.keys(previousV3.jobs).length : undefined, generated);
  writeFileSync(join(out, "stats.json"), `${JSON.stringify({ generated_at: generated, groups, ats: stats, ats_jobs: atsJobs, alerts, coverage, v1: { previous: v1Previous }, v2, v3 }, null, 2)}\n`);
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
