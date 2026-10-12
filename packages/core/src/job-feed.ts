import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync } from "node:zlib";
import { applyFeedDiff, feedStateHash, JOB_FEED_SCHEMA_V2, type FeedDiff, type FeedManifestV2, type FeedSnapshot, type FeedState } from "./job-feed-diff";
import { fetchSignedJson, FILE_TIMEOUT_MS } from "./data-signing";
import { envSetting } from "./env";
import { isSafeName, safeJoin } from "./safe-name";
import { passesLocationGate, passesTitleGate } from "./score";
import type { Profile, Workplace } from "./schema";
import { writeFileAtomic } from "./atomic";

/**
 * The shared job feed: every live directory board's open jobs, fetched once a day for everyone
 * (scripts/catalog/jobs.ts, the "Jobs · daily feed" workflow) and published as one gzipped shard per
 * hiring system. A scan uses it only to choose which directory companies to fetch live: a company
 * whose jobs yesterday had nothing for you is skipped, one that had is fetched live, so every job
 * shown is still checked live. Nothing about the user is sent anywhere; filtering happens here.
 */
export const DEFAULT_JOB_FEED_URL = "https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/download/jobs";
export const jobFeedUrl = () => (envSetting("JOBS_URL") ?? DEFAULT_JOB_FEED_URL).replace(/\/$/, "");

/** Format version: clients ignore a feed whose schema they don't know. */
export const JOB_FEED_SCHEMA = 1;
/** A company's feed entry older than this doesn't count: the scan fetches it live. */
export const FEED_MAX_AGE_DAYS = 3;

/** [ats job id, title, location, workplace, posted date (YYYY-MM-DD) or null] */
export type FeedRow = [string, string, string, Workplace, string | null];

export type JobFeedShard = {
  schema: number;
  ats: string;
  generated_at: string;
  /** By jobCompanyKey() ("greenhouse:acme", "workday:tenant|site"). */
  companies: Record<string, { fetched_at: string; jobs: FeedRow[] }>;
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
  const v2 = readJson<V2Index>(join(feedDir(dataDir), V2_INDEX));
  if (v2) return { generated_at: v2.generated_at, ageDays: (now - Date.parse(v2.generated_at)) / 86_400_000, companies: Object.keys(v2.verified).length };
  const m = readJson<JobFeedManifest>(join(feedDir(dataDir), "manifest.json"));
  const companies = Object.values(m?.shards ?? {}).reduce((n, s) => n + s.companies, 0);
  return { generated_at: m?.generated_at, ageDays: m ? (now - Date.parse(m.generated_at)) / 86_400_000 : Infinity, companies };
}

export type FeedSyncResult = { updated: boolean; message: string; ageDays: number };

/**
 * Download the shards that changed since the local copy (checked against the manifest's SHA-256).
 * Never throws: without the feed, scans fetch every company live as before.
 */
export async function syncJobFeed(dataDir: string, opts: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<FeedSyncResult> {
  const get = opts.fetchImpl ?? fetch;
  const dir = feedDir(dataDir);
  const stale = () => jobFeedStatus(dataDir, opts.now).ageDays;
  try {
    // The second format first (a full copy once, then a small change file a day); older feeds only have the first.
    // A badly signed manifest stops here: falling back to the other format would let a tamperer pick.
    const badSignature = { updated: false, ageDays: stale(), message: "The job feed's signature isn't valid; scanning every company live." };
    const v2 = await fetchSignedJson<FeedManifestV2>(get, `${jobFeedUrl()}/${V2_MANIFEST}`);
    if (v2.ok && v2.value.schema === JOB_FEED_SCHEMA_V2) return { ...(await syncV2(dir, v2.value, get)), ageDays: stale() };
    if (!v2.ok && v2.status === null) return badSignature;
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
    const age = stale();
    const when = age < 1 ? "today" : `${Math.round(age)} day(s) old`;
    return { updated: fetched > 0, ageDays: age, message: fetched ? `Job feed updated (${when}).` : `Job feed is up to date (${when}).` };
  } catch (err) {
    return { updated: false, ageDays: stale(), message: `Couldn't reach the job feed (${(err as Error).message}); scanning every company live.` };
  }
}

// ---------- the second format: a full copy, then a change file a day (job-feed-diff.ts) ----------

const V2_MANIFEST = "jobs-v2-manifest.json";
/** The local copy: every company's jobs, brotli-compressed. */
const V2_STATE = "v2-state.json.br";
/** What's in the local copy, without its jobs: version, day each company was read, which changed when. */
const V2_INDEX = "v2-index.json";
const V2_MATCHES = "v2-matches.json";
/** Change history kept in the index, for remembered matches older than this many versions. */
const KEEP_TOUCHED = 30;

type V2Index = {
  seq: number;
  generated_at: string;
  state_sha256: string;
  verified: Record<string, string>;
  /** Company -> the version that last changed its jobs. */
  touched: Record<string, number>;
  /** The version last taken as a full copy: everything changed then. */
  full_at: number;
};

const readState = (dir: string): FeedState | undefined => {
  try {
    return JSON.parse(brotliDecompressSync(readFileSync(join(dir, V2_STATE))).toString("utf8")) as FeedState;
  } catch {
    return undefined;
  }
};

async function download(get: typeof fetch, file: string, sha256: string): Promise<Buffer> {
  if (!isSafeName(file)) throw new Error(`the manifest names an unsafe file (${JSON.stringify(file)})`);
  const r = await get(`${jobFeedUrl()}/${file}`, { redirect: "follow", signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`download of ${file} failed (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash("sha256").update(buf).digest("hex") !== sha256) throw new Error(`${file} didn't match its checksum`);
  return buf;
}
const unbrotli = <T>(buf: Buffer) => JSON.parse(brotliDecompressSync(buf).toString("utf8")) as T;

/**
 * Bring the local copy to the manifest's version: apply the change files since the local version, and
 * check the result against the manifest's fingerprint; when that doesn't work (too far behind, a file
 * missing, a mismatch), take the full copy. The local copy is only replaced once the new one is complete.
 */
async function syncV2(dir: string, m: FeedManifestV2, get: typeof fetch): Promise<{ updated: boolean; message: string }> {
  const index = readJson<V2Index>(join(dir, V2_INDEX));
  if (index?.seq === m.seq && index.state_sha256 === m.state_sha256) return { updated: false, message: `Job feed is up to date (${when(m.generated_at)}).` };
  const touched = { ...(index?.touched ?? {}) };
  let fullAt = index?.full_at ?? m.seq;
  let state: FeedState | undefined;
  let bytes = 0;
  let steps = 0;
  const chain = index ? m.diffs.filter((d) => d.seq > index.seq) : [];
  if (index && chain.length && chain[0]!.seq === index.seq + 1 && chain.length === m.seq - index.seq) {
    try {
      state = readState(dir);
      for (const d of state ? chain : []) {
        const buf = await download(get, d.file, d.sha256);
        bytes += buf.length;
        for (const key of applyFeedDiff(state!, unbrotli<FeedDiff>(buf))) touched[key] = d.seq;
        steps++;
      }
      if (state && feedStateHash(state) !== m.state_sha256) state = undefined;
    } catch {
      state = undefined;
    }
  }
  if (!state) {
    const buf = await download(get, m.snapshot.file, m.snapshot.sha256);
    bytes += buf.length;
    const snap = unbrotli<FeedSnapshot>(buf);
    state = { verified: snap.verified, jobs: snap.jobs };
    fullAt = m.seq;
    steps = 0;
    for (const k of Object.keys(touched)) delete touched[k];
  }
  for (const [k, seq] of Object.entries(touched)) if (seq <= m.seq - KEEP_TOUCHED || !(k in state.jobs)) delete touched[k];
  mkdirSync(dir, { recursive: true });
  // Fastest brotli: the local copy is rewritten after every update, and disk is cheaper than the wait (29 MB vs 23 MB at 5, 0.8 s vs 4.4 s).
  const body = brotliCompressSync(JSON.stringify(state), { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } });
  writeFileSync(join(dir, `${V2_STATE}.tmp`), body);
  renameSync(join(dir, `${V2_STATE}.tmp`), join(dir, V2_STATE));
  const next: V2Index = { seq: m.seq, generated_at: m.generated_at, state_sha256: m.state_sha256, verified: state.verified, touched, full_at: fullAt };
  writeFileAtomic(join(dir, V2_INDEX), JSON.stringify(next));
  // The first format's files aren't needed any more.
  for (const f of readdirSync(dir)) if (f === "manifest.json" || f === "matches.json" || /^[a-z]+\.json$/.test(f)) rmSync(join(dir, f), { force: true });
  const size = `${(bytes / 1e6).toFixed(1)} MB`;
  return { updated: true, message: steps ? `Job feed updated with ${steps} day(s) of changes (${size}, ${when(m.generated_at)}).` : `Job feed downloaded (${size}, ${when(m.generated_at)}).` };
}

const when = (generatedAt: string) => {
  const age = (Date.now() - Date.parse(generatedAt)) / 86_400_000;
  return age < 1 ? "today" : `${Math.round(age)} day(s) old`;
};

/** "3 Locations": the list doesn't say where, so only the title can rule the job out. */
const VAGUE_LOCATION = /^\s*(\d+\s+locations?|multiple locations?|various)?\s*$/i;

export type FeedMatches = {
  /** Companies with a fresh feed entry: their jobs are known as of the feed. */
  covered: Set<string>;
  /** Covered companies with at least one job that passes your title and location filters. */
  matching: Set<string>;
};

/**
 * Bump when title or location matching changes, so results remembered by older code are recomputed.
 * (Results are remembered per feed shard and profile: see feedMatches.)
 */
const MATCHING_VERSION = 2;

/** Remembered feedMatches results: per shard (by its SHA-256), for one profile. */
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
  return ([, title, location, workplace]) => {
    let t = titleOk.get(title);
    if (t === undefined) titleOk.set(title, (t = passesTitleGate(title, profile)));
    if (!t) return false;
    // "3 Locations": the list doesn't say where, so only the title can rule the job out.
    if (VAGUE_LOCATION.test(location)) return true;
    const where = `${workplace}\u0000${location}`;
    let l = placeOk.get(where);
    if (l === undefined) placeOk.set(where, (l = passesLocationGate({ location, workplace }, profile)));
    return l;
  };
}

/** Remembered feedMatchesV2 results: the matching companies at one version, for one profile. */
type V2MatchCache = { version: number; profile: string; seq: number; matching: string[] };

/**
 * feedMatches for the second format. With the same profile, only companies whose jobs changed since the
 * remembered answer are checked again (usually a third of them), and none when nothing changed.
 */
function feedMatchesV2(dir: string, index: V2Index, profile: Profile, cutoff: number): FeedMatches {
  const key = profileKey(profile);
  const old = readJson<V2MatchCache>(join(dir, V2_MATCHES));
  // Usable while the index still knows every change since then (it keeps KEEP_TOUCHED versions of history).
  const usable = old?.version === MATCHING_VERSION && old.profile === key && old.seq >= index.full_at && old.seq <= index.seq && old.seq > index.seq - KEEP_TOUCHED;
  let matching = new Set(usable ? old.matching.filter((k) => k in index.verified) : []);
  if (!usable || old.seq < index.seq) {
    const state = readState(dir);
    if (!state) return { covered: new Set(), matching: new Set() };
    const passes = rowMatcher(profile);
    const recheck = usable ? Object.keys(index.touched).filter((k) => index.touched[k]! > old.seq) : Object.keys(state.jobs);
    if (!usable) matching = new Set();
    for (const k of recheck) {
      if ((state.jobs[k] ?? []).some(passes)) matching.add(k);
      else matching.delete(k);
    }
    try {
      writeFileSync(join(dir, V2_MATCHES), JSON.stringify({ version: MATCHING_VERSION, profile: key, seq: index.seq, matching: [...matching] } satisfies V2MatchCache));
    } catch {
      // Only a speed-up.
    }
  }
  const covered = new Set(Object.keys(index.verified).filter((k) => Date.parse(index.verified[k]!) >= cutoff));
  return { covered, matching: new Set([...matching].filter((k) => covered.has(k))) };
}

/**
 * Which directory companies the feed can rule out for this profile. Empty sets without a feed.
 * Each distinct title and location is checked once (titles first: a quick word check rules most out),
 * and the answer per company is remembered per shard, so a shard that didn't change since the last
 * scan, with the same profile, isn't read again.
 */
export function feedMatches(dataDir: string, profile: Profile, now = Date.now(), maxAgeDays = FEED_MAX_AGE_DAYS): FeedMatches {
  const covered = new Set<string>();
  const matching = new Set<string>();
  const dir = feedDir(dataDir);
  const cutoff = now - maxAgeDays * 86_400_000;
  const v2 = readJson<V2Index>(join(dir, V2_INDEX));
  if (v2) return feedMatchesV2(dir, v2, profile, cutoff);
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
