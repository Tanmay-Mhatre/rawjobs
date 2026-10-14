import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { ACTIVITY_SCHEMA, dayNumber, type ActivityFile } from "./activity";
import { compactMatcher, VAGUE_LOCATION } from "./job-feed-compact";
import { readDict, readStore, removeStore, storeApplyDiffs, storeFromSnapshot, type StoreFiles, type StoreResult } from "./job-feed-store";
import { JOB_FEED_SCHEMA_V3, type FeedDiff, type FeedManifestV2, type FeedRow } from "./job-feed-diff";
import { fetchSignedJson, FILE_TIMEOUT_MS } from "./data-signing";
import { envSetting } from "./env";
import { isSafeName, safeJoin } from "./safe-name";
import { passesLocationGate, passesTitleGate } from "./score";
import type { Profile } from "./schema";
import { writeFileAtomic } from "./atomic";

/**
 * The shared job feed: every live directory board's open jobs, fetched every 6 hours for everyone
 * (scripts/catalog/jobs.ts, the "Jobs · feed" workflow). A scan uses it only to choose which directory
 * companies to fetch live: a company whose jobs in the feed have nothing for you is skipped, one that
 * has is fetched live, so every job shown is still checked live. Nothing about the user is sent
 * anywhere; filtering happens here.
 *
 * Formats: the third (every hiring system, compact; job-feed-compact.ts) is read first; without it, the
 * first (one gzipped shard per original hiring system). The second is only for older apps.
 */
export const DEFAULT_JOB_FEED_URL = "https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/download/jobs";
export const jobFeedUrl = () => (envSetting("JOBS_URL") ?? DEFAULT_JOB_FEED_URL).replace(/\/$/, "");

/** Format version: clients ignore a feed whose schema they don't know. */
export const JOB_FEED_SCHEMA = 1;
/** A company's feed entry older than this doesn't count: the scan fetches it live. */
export const FEED_MAX_AGE_DAYS = 3;

export type { FeedRow } from "./job-feed-diff";

export type JobFeedShard = {
  schema: number;
  ats: string;
  generated_at: string;
  /** By jobCompanyKey() ("greenhouse:acme", "workday:tenant|site"). `partial`: the board stopped at a cap. */
  companies: Record<string, { fetched_at: string; jobs: FeedRow[]; partial?: boolean }>;
};

export type JobFeedManifest = {
  schema: number;
  generated_at: string;
  shards: Record<string, { file: string; sha256: string; bytes: number; companies: number; jobs: number }>;
};

const feedDir = (dataDir: string) => join(dataDir, "catalog", "jobs");
const readJson = <T>(path: string): T | undefined => {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
};

export type JobFeedStatus = { generated_at?: string; ageDays: number; companies: number };

export function jobFeedStatus(dataDir: string, now = Date.now()): JobFeedStatus {
  const v3 = readJson<V3Index>(join(feedDir(dataDir), V3_INDEX));
  if (v3) return { generated_at: v3.generated_at, ageDays: (now - Date.parse(v3.generated_at)) / 86_400_000, companies: Object.keys(v3.verified).length };
  const m = readJson<JobFeedManifest>(join(feedDir(dataDir), "manifest.json"));
  const companies = Object.values(m?.shards ?? {}).reduce((n, s) => n + s.companies, 0);
  return { generated_at: m?.generated_at, ageDays: m ? (now - Date.parse(m.generated_at)) / 86_400_000 : Infinity, companies };
}

export type FeedSyncResult = { updated: boolean; message: string; ageDays: number };

/**
 * Bring the local copy up to date: the third format's change files (or its full copy), or else the
 * first format's shards that changed (checked against the manifest's SHA-256).
 * Never throws: without the feed, scans fetch every company live as before.
 */
export async function syncJobFeed(dataDir: string, opts: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<FeedSyncResult> {
  const get = opts.fetchImpl ?? fetch;
  const dir = feedDir(dataDir);
  const stale = () => jobFeedStatus(dataDir, opts.now).ageDays;
  try {
    // A badly signed manifest stops here: falling back to the other format would let a tamperer pick.
    const badSignature = { updated: false, ageDays: stale(), message: "The job feed's signature isn't valid; scanning every company live." };
    const v3 = await fetchSignedJson<FeedManifestV2>(get, `${jobFeedUrl()}/${V3_MANIFEST}`);
    if (v3.ok && v3.value.schema === JOB_FEED_SCHEMA_V3) {
      const synced = await syncV3(dir, v3.value, get, opts.now);
      await syncActivity(dir, v3.value, get);
      return { ...synced, ageDays: stale() };
    }
    if (!v3.ok && v3.status === null) return badSignature;
    const res = await fetchSignedJson<JobFeedManifest>(get, `${jobFeedUrl()}/jobs-manifest.json`);
    if (!res.ok) return res.status ? { updated: false, ageDays: stale(), message: `Job feed unavailable (HTTP ${res.status}); scanning every company live.` } : badSignature;
    const manifest = res.value;
    if (manifest.schema !== JOB_FEED_SCHEMA) return { updated: false, ageDays: stale(), message: "The job feed has a newer format than this app; update the app to use it." };
    const local = readJson<JobFeedManifest>(join(dir, "manifest.json"));
    mkdirSync(dir, { recursive: true });
    let fetched = 0;
    const unsafe = Object.entries(manifest.shards).find(([ats, shard]) => !isSafeName(ats) || !isSafeName(shard.file));
    if (unsafe) return { updated: false, ageDays: stale(), message: "The job feed's manifest names an unsafe file; scanning every company live." };
    for (const [ats, shard] of Object.entries(manifest.shards)) {
      if (local?.shards[ats]?.sha256 === shard.sha256 && existsSync(join(dir, `${ats}.json`))) continue;
      const r = await get(`${jobFeedUrl()}/${shard.file}`, { redirect: "follow", signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
      if (!r.ok) return { updated: fetched > 0, ageDays: stale(), message: `Job feed download of ${shard.file} failed (HTTP ${r.status}).` };
      const gz = Buffer.from(await r.arrayBuffer());
      if (createHash("sha256").update(gz).digest("hex") !== shard.sha256) return { updated: fetched > 0, ageDays: stale(), message: `${shard.file} didn't match its checksum; kept the old copy.` };
      writeFileSync(safeJoin(dir, `${ats}.json.tmp`), gunzipSync(gz));
      renameSync(safeJoin(dir, `${ats}.json.tmp`), safeJoin(dir, `${ats}.json`));
      fetched++;
    }
    writeFileAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const age = when(manifest.generated_at, opts.now);
    return { updated: fetched > 0, ageDays: stale(), message: fetched ? `Job feed updated (${age}).` : `Job feed is up to date (${age}).` };
  } catch (err) {
    return { updated: false, ageDays: stale(), message: `Couldn't reach the job feed (${(err as Error).message}); scanning every company live.` };
  }
}

/** How old the feed is, in hours: it's rebuilt every 6 hours. */
const when = (generatedAt: string, now = Date.now()) => {
  const hours = (now - Date.parse(generatedAt)) / 3_600_000;
  return hours < 1 ? "under an hour old" : `${Math.round(hours)} h old`;
};

// ---------- the third format: a full copy, then a change file per run (job-feed-diff.ts, job-feed-store.ts) ----------

const V3_MANIFEST = "jobs-v3-manifest.json";
/** What's in the local copy besides its jobs: version, when each company was read, which changed when, its files. */
const V3_INDEX = "v3-index.json";
const V3_MATCHES = "v3-matches.json";
/** Change history kept in the index, in feed versions (4 a day), for remembered matches older than that. */
const KEEP_TOUCHED = 120;
/**
 * Take the full copy again once change files have grown the local dictionary by this much: they only
 * ever add titles and places, and the full copy has just the ones in use.
 */
const DICT_GROWTH = 1.3;

type V3Index = StoreFiles & {
  seq: number;
  generated_at: string;
  state_sha256: string;
  verified: Record<string, string>;
  /** Companies whose board stopped at a cap: the scan fetches them live. */
  partial: string[];
  /** Company -> the version that last changed its jobs. */
  touched: Record<string, number>;
  /** The version last taken as a full copy: everything changed then. */
  full_at: number;
  /** Titles + places in the dictionary now, and after the last full copy. */
  dict_size: number;
  dict_base: number;
};

async function download(get: typeof fetch, file: string, sha256: string): Promise<Buffer> {
  if (!isSafeName(file)) throw new Error(`the manifest names an unsafe file (${JSON.stringify(file)})`);
  const r = await get(`${jobFeedUrl()}/${file}`, { redirect: "follow", signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`download of ${file} failed (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash("sha256").update(buf).digest("hex") !== sha256) throw new Error(`${file} didn't match its checksum`);
  return buf;
}

/**
 * Bring the local copy to the manifest's version: apply the change files since the local version, and
 * check the result against the manifest's fingerprint; when that doesn't work (too far behind, a file
 * missing, a mismatch), take the full copy. The local copy is only replaced once the new one is complete
 * and checked. Either way the feed streams through memory a part at a time (job-feed-store.ts).
 */
async function syncV3(dir: string, m: FeedManifestV2, get: typeof fetch, now?: number): Promise<{ updated: boolean; message: string }> {
  const index = readJson<V3Index>(join(dir, V3_INDEX));
  if (index?.seq === m.seq && index.state_sha256 === m.state_sha256) return { updated: false, message: `Job feed is up to date (${when(m.generated_at, now)}).` };
  mkdirSync(dir, { recursive: true });
  const tag = `${m.seq}-${Date.now().toString(36)}`;
  const touched = { ...(index?.touched ?? {}) };
  let fullAt = index?.full_at ?? m.seq;
  let dictBase = index?.dict_base ?? 0;
  let next: StoreResult | undefined;
  let bytes = 0;
  let steps = 0;
  const chain = index ? m.diffs.filter((d) => d.seq > index.seq) : [];
  const grown = !!index && index.dict_size > index.dict_base * DICT_GROWTH;
  if (index?.parts && !grown && chain.length && chain[0]!.seq === index.seq + 1 && chain.length === m.seq - index.seq) {
    try {
      const diffs: FeedDiff[] = [];
      for (const d of chain) {
        const buf = await download(get, d.file, d.sha256);
        bytes += buf.length;
        diffs.push(JSON.parse(brotliDecompressSync(buf).toString("utf8")) as FeedDiff);
      }
      next = storeApplyDiffs(dir, index, diffs, tag);
      if (next.hash !== m.state_sha256) {
        removeStore(dir, next);
        next = undefined;
      } else {
        Object.assign(touched, next.touched);
        steps = diffs.length;
      }
    } catch {
      next = undefined;
    }
  }
  if (!next) {
    const buf = await download(get, m.snapshot.file, m.snapshot.sha256);
    bytes += buf.length;
    next = await storeFromSnapshot(dir, buf, tag);
    if (next.hash !== m.state_sha256) {
      removeStore(dir, next);
      throw new Error("the full copy didn't match its fingerprint");
    }
    fullAt = m.seq;
    dictBase = next.dictSize;
    steps = 0;
    for (const k of Object.keys(touched)) delete touched[k];
  }
  for (const [k, seq] of Object.entries(touched)) if (seq <= m.seq - KEEP_TOUCHED || !(k in next.verified)) delete touched[k];
  const written: V3Index = {
    seq: m.seq,
    generated_at: m.generated_at,
    state_sha256: m.state_sha256,
    verified: next.verified,
    partial: next.partial,
    touched,
    full_at: fullAt,
    dict_size: next.dictSize,
    dict_base: dictBase,
    dict: next.dict,
    parts: next.parts,
  };
  writeFileAtomic(join(dir, V3_INDEX), JSON.stringify(written));
  // The old copy's files, and the older formats', aren't needed any more.
  const keep = new Set([next.dict, ...next.parts]);
  for (const f of readdirSync(dir))
    if (((/^v3-(part|dict)-/.test(f) && !keep.has(f)) || f === "manifest.json" || f === "matches.json" || /^[a-z]+\.json$/.test(f) || f.startsWith("v2-")) && f !== V3_INDEX && f !== V3_MATCHES)
      rmSync(join(dir, f), { force: true });
  const size = `${(bytes / 1e6).toFixed(1)} MB`;
  return { updated: true, message: steps ? `Job feed updated with ${steps} change file(s) (${size}, ${when(m.generated_at, now)}).` : `Job feed downloaded (${size}, ${when(m.generated_at, now)}).` };
}

// ---------- hiring activity, listed in the third format's manifest (activity.ts) ----------

/** The local copy of the feed's activity file, as downloaded (brotli). */
const ACTIVITY_LOCAL = "activity.json.br";
/** An activity file older than this isn't shown: its "last 30 days" would be out of date. */
const ACTIVITY_MAX_AGE_DAYS = 7;

/**
 * Download the activity file the manifest lists, when the local copy isn't it. Optional: a manifest
 * without one, or a failed download, keeps the local copy (readFeedActivity stops using it once it's old).
 */
async function syncActivity(dir: string, m: FeedManifestV2, get: typeof fetch): Promise<void> {
  if (!m.activity) return;
  const local = join(dir, ACTIVITY_LOCAL);
  try {
    if (existsSync(local) && createHash("sha256").update(readFileSync(local)).digest("hex") === m.activity.sha256) return;
    const buf = await download(get, m.activity.file, m.activity.sha256);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${local}.tmp`, buf);
    renameSync(`${local}.tmp`, local);
  } catch {
    // Only the "Hiring at …" block and the surge tag go without it.
  }
}

/** The feed's hiring activity, if downloaded, readable and recent; undefined otherwise. */
export function readFeedActivity(dataDir: string, now = Date.now()): ActivityFile | undefined {
  try {
    const path = join(feedDir(dataDir), ACTIVITY_LOCAL);
    if (!existsSync(path)) return undefined;
    const file = JSON.parse(brotliDecompressSync(readFileSync(path)).toString("utf8")) as ActivityFile;
    if (file.schema !== ACTIVITY_SCHEMA || typeof file.date !== "string" || !file.companies) return undefined;
    return Math.floor(now / 86_400_000) - dayNumber(file.date) > ACTIVITY_MAX_AGE_DAYS ? undefined : file;
  } catch {
    return undefined;
  }
}

export type FeedMatches = {
  /** Companies with a fresh, complete feed entry: their jobs are known as of the feed. */
  covered: Set<string>;
  /** Covered companies with at least one job that passes your title and location filters. */
  matching: Set<string>;
};

/**
 * Bump when title or location matching changes, so results remembered by older code are recomputed.
 * (Results are remembered per feed version and profile: see feedMatches.)
 */
const MATCHING_VERSION = 3;

/** Remembered feedMatches results (first format): per shard (by its SHA-256), for one profile. */
type MatchCache = {
  version: number;
  profile: string;
  shards: Record<string, { sha256: string; companies: [key: string, fetchedAt: string, matching: 0 | 1][] }>;
};

/** What in a profile decides the title and location gates. */
const profileKey = (profile: Profile) => JSON.stringify([MATCHING_VERSION, profile.titles, profile.locations]);

/** Does a feed job pass the profile's title and location gates? Each distinct title and place is checked once. */
function rowMatcher(profile: Profile): (row: FeedRow) => boolean {
  const titleOk = new Map<string, boolean>();
  const placeOk = new Map<string, boolean>();
  const place = (location: string, workplace: FeedRow[3]) => {
    const where = `${workplace}\u0000${location}`;
    let l = placeOk.get(where);
    if (l === undefined) placeOk.set(where, (l = passesLocationGate({ location, workplace }, profile)));
    return l;
  };
  return ([, title, location, workplace, , resolved]) => {
    let t = titleOk.get(title);
    if (t === undefined) titleOk.set(title, (t = passesTitleGate(title, profile)));
    if (!t) return false;
    // "3 Locations": the list doesn't say where, so only the title (or where the build looked up) can rule it out.
    if (VAGUE_LOCATION.test(location)) return resolved === undefined || place(resolved, workplace);
    return place(location, workplace);
  };
}

/** Remembered feedMatchesV3 results: the matching companies at one version, for one profile. */
type V3MatchCache = { version: number; profile: string; seq: number; matching: string[] };

/**
 * feedMatches for the third format. With the same profile, only companies whose jobs changed since the
 * remembered answer are checked again (a 6-hourly change touches 1–2% of jobs), and none when nothing changed.
 */
function feedMatchesV3(dir: string, index: V3Index, profile: Profile, cutoff: number): FeedMatches {
  const key = profileKey(profile);
  const old = readJson<V3MatchCache>(join(dir, V3_MATCHES));
  // Usable while the index still knows every change since then (it keeps KEEP_TOUCHED versions of history).
  const usable = old?.version === MATCHING_VERSION && old.profile === key && old.seq >= index.full_at && old.seq <= index.seq && old.seq > index.seq - KEEP_TOUCHED;
  let matching = new Set(usable ? old.matching.filter((k) => k in index.verified) : []);
  if (!usable || old.seq < index.seq) {
    const recheck = usable ? new Set(Object.keys(index.touched).filter((k) => index.touched[k]! > old.seq)) : undefined;
    let dict: ReturnType<typeof readDict>;
    try {
      dict = readDict(dir, index.dict);
    } catch {
      return { covered: new Set(), matching: new Set() };
    }
    const passes = compactMatcher(
      dict,
      (title) => passesTitleGate(title, profile),
      (location, workplace) => passesLocationGate({ location, workplace }, profile),
    );
    if (!usable) matching = new Set();
    // One part in memory at a time; only the companies to check again are unpacked.
    try {
      for (const { key, packed } of readStore(dir, index.parts, recheck ? (k) => recheck.has(k) : undefined)) {
        if (passes(packed)) matching.add(key);
        else matching.delete(key);
      }
    } catch {
      return { covered: new Set(), matching: new Set() };
    }
    try {
      writeFileSync(join(dir, V3_MATCHES), JSON.stringify({ version: MATCHING_VERSION, profile: key, seq: index.seq, matching: [...matching] } satisfies V3MatchCache));
    } catch {
      // Only a speed-up.
    }
  }
  // A capped board's feed entry isn't all its jobs: it isn't covered, so the scan fetches it live.
  const partial = new Set(index.partial ?? []);
  const covered = new Set(Object.keys(index.verified).filter((k) => !partial.has(k) && Date.parse(index.verified[k]!) >= cutoff));
  return { covered, matching: new Set([...matching].filter((k) => covered.has(k))) };
}

/**
 * Which directory companies the feed can rule out for this profile. Empty sets without a feed.
 * Each distinct title and location is checked once (titles first: a quick word check rules most out),
 * and the answer per company is remembered, so with the same profile only what changed is read again.
 */
export function feedMatches(dataDir: string, profile: Profile, now = Date.now(), maxAgeDays = FEED_MAX_AGE_DAYS): FeedMatches {
  const covered = new Set<string>();
  const matching = new Set<string>();
  const dir = feedDir(dataDir);
  const cutoff = now - maxAgeDays * 86_400_000;
  const v3 = readJson<V3Index>(join(dir, V3_INDEX));
  if (v3) return feedMatchesV3(dir, v3, profile, cutoff);
  const manifest = readJson<JobFeedManifest>(join(dir, "manifest.json"));
  if (manifest?.schema !== JOB_FEED_SCHEMA) return { covered, matching };
  const key = profileKey(profile);
  const old = readJson<MatchCache>(join(dir, "matches.json"));
  const cache: MatchCache = { version: MATCHING_VERSION, profile: key, shards: {} };
  const passes = rowMatcher(profile);
  for (const [ats, meta] of Object.entries(manifest.shards)) {
    if (!isSafeName(ats)) continue;
    const known = old?.version === MATCHING_VERSION && old.profile === key && old.shards[ats]?.sha256 === meta.sha256 ? old.shards[ats] : undefined;
    let rows = known?.companies;
    if (!rows) {
      const shard = readJson<JobFeedShard>(join(dir, `${ats}.json`));
      if (shard?.schema !== JOB_FEED_SCHEMA) continue;
      rows = Object.entries(shard.companies).map(([k, e]) => [k, e.fetched_at, e.jobs.some(passes) ? 1 : 0]);
    }
    cache.shards[ats] = { sha256: meta.sha256, companies: rows };
    for (const [k, fetchedAt, hit] of rows) {
      if (Date.parse(fetchedAt) < cutoff) continue;
      covered.add(k);
      if (hit) matching.add(k);
    }
  }
  try {
    writeFileSync(join(dir, "matches.json"), JSON.stringify(cache));
  } catch {
    // Only a speed-up: without it the next scan checks the feed again.
  }
  return { covered, matching };
}
