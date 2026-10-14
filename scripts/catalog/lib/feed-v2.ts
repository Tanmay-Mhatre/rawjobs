/**
 * The job feed's change-file formats (packages/core/src/job-feed-diff.ts): a full copy plus a change file
 * per run, so apps that are up to date download only what changed. Written next to the first format.
 *
 *   2  jobs-v2-*: JSON full copies of the five original hiring systems, for apps from before schema 3.
 *   3  jobs-v3-*: every hiring system, full copies in the compact text format (job-feed-compact.ts).
 *
 * In <out>: jobs-v<n>-snapshot-<seq>.<ext>.br (full copy), jobs-v<n>-diff-<seq>.json.br (this run's
 * changes), jobs-v<n>-manifest.json (upload it last). The previous run's snapshot and manifest must be in
 * <out> (the feed's saved state) for a change file to be made; without them, apps download the full copy.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import {
  applyFeedDiff,
  compactOf,
  decodeCompact,
  diffFeedStates,
  encodeCompact,
  feedStateHash,
  JOB_FEED_SCHEMA_V2,
  JOB_FEED_SCHEMA_V3,
  stateOfCompact,
  type FeedManifestV2,
  type FeedRow,
  type FeedSnapshot,
  type FeedState,
} from "@rawjobs/core";

/** Change files kept in a manifest (4 runs a day: 14 days): an app further behind downloads the full copy. */
export const KEEP_DIFFS = 56;

export type FeedFormat = 2 | 3;
const MANIFEST = (f: FeedFormat) => `jobs-v${f}-manifest.json`;
const SNAPSHOT = (f: FeedFormat, seq: number) => (f === 3 ? `jobs-v3-snapshot-${seq}.txt.br` : `jobs-v2-snapshot-${seq}.json.br`);

const brotli = (b: Buffer) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** No field may hold a tab or a line break: the compact format is tab- and line-separated. */
const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
export const cleanRow = (r: FeedRow): FeedRow => {
  const row: FeedRow = [clean(r[0]), clean(r[1]), clean(r[2]), r[3], r[4]];
  if (r.length > 5 && r[5] !== undefined) row.push(clean(r[5]));
  return row;
};

/**
 * This run's companies (from the first format's shards) as a state: rows by id, when last read (full ISO
 * time). The second format stays as it was: five columns, no partial companies.
 */
export function stateOf(companies: Record<string, { fetched_at: string; jobs: FeedRow[]; partial?: boolean }>, format: FeedFormat = 2): FeedState {
  const state: FeedState = { verified: {}, jobs: {} };
  const partial: string[] = [];
  for (const [key, c] of Object.entries(companies)) {
    state.verified[key] = c.fetched_at;
    // One row per job id: a change file names jobs by id.
    const rows = [...new Map(c.jobs.map((r) => [clean(r[0]), r])).values()].map(cleanRow);
    state.jobs[key] = format === 2 ? rows.map((r) => r.slice(0, 5) as FeedRow) : rows;
    if (c.partial) partial.push(key);
  }
  if (format === 3) state.partial = partial.sort();
  return state;
}

/** A full copy's file name, as a manifest may name it: nothing else is read from a downloaded manifest. */
export const SNAPSHOT_FILE = /^jobs-v2-snapshot-\d+\.json\.br$/;
const SNAPSHOT_FILE_V3 = /^jobs-v3-snapshot-\d+\.txt\.br$/;

/**
 * The full copy a format's manifest in `dir` names, or undefined when either is missing, of another
 * schema, misnamed or unreadable.
 */
export function readFeed(dir: string, format: FeedFormat): { manifest: FeedManifestV2; state: FeedState } | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST(format)), "utf8")) as FeedManifestV2;
    const name = manifest.snapshot?.file;
    const schema = format === 3 ? JOB_FEED_SCHEMA_V3 : JOB_FEED_SCHEMA_V2;
    if (manifest.schema !== schema || typeof name !== "string" || !(format === 3 ? SNAPSHOT_FILE_V3 : SNAPSHOT_FILE).test(name)) return undefined;
    const file = join(dir, name);
    if (!existsSync(file)) return undefined;
    const raw = brotliDecompressSync(readFileSync(file));
    if (format === 3) return { manifest, state: stateOfCompact(decodeCompact(raw)) };
    const snap = JSON.parse(raw.toString("utf8")) as FeedSnapshot;
    if (snap.schema !== JOB_FEED_SCHEMA_V2 || !snap.jobs) return undefined;
    return { manifest, state: { verified: snap.verified ?? {}, jobs: snap.jobs } };
  } catch {
    return undefined;
  }
}

/** The second format's full copy (industry tags read job titles from it: lib/tags.ts). */
export const readFeedV2 = (dir: string) => readFeed(dir, 2);

export type V2Result = { seq: number; snapshotBytes: number; diffBytes?: number; changedCompanies?: number; note?: string; previousSnapshot?: string };

export function writeFeed(out: string, state: FeedState, generated: string, format: FeedFormat): V2Result {
  const prev = readFeed(out, format);
  const seq = (prev?.manifest.seq ?? 0) + 1;
  const schema = format === 3 ? JOB_FEED_SCHEMA_V3 : JOB_FEED_SCHEMA_V2;
  const stateSha = feedStateHash(state);
  const snapBuf =
    format === 3
      ? brotli(encodeCompact(compactOf(state, { seq, generated_at: generated })))
      : brotli(Buffer.from(JSON.stringify({ schema, seq, generated_at: generated, verified: state.verified, jobs: state.jobs } satisfies FeedSnapshot)));
  const snapFile = SNAPSHOT(format, seq);
  writeFileSync(join(out, snapFile), snapBuf);
  const diffFile = `jobs-v${format}-diff-${seq}.json.br`;

  // The previous full copy stays published one more run: an app may be part-way through downloading it.
  const result: V2Result = { seq, snapshotBytes: snapBuf.length, ...(prev ? { previousSnapshot: prev.manifest.snapshot.file } : {}) };
  let diffs = prev?.manifest.diffs ?? [];
  if (prev) {
    const diff = diffFeedStates(prev.state, state, { schema, seq, generated_at: generated, date: generated });
    // Check the change file before publishing it: the previous copy plus it must be this copy exactly.
    const check: FeedState = { verified: { ...prev.state.verified }, jobs: { ...prev.state.jobs }, ...(prev.state.partial ? { partial: prev.state.partial } : {}) };
    applyFeedDiff(check, diff);
    if (feedStateHash(check) === stateSha) {
      const buf = brotli(Buffer.from(JSON.stringify(diff)));
      writeFileSync(join(out, diffFile), buf);
      diffs = [...diffs, { seq, file: diffFile, sha256: sha(buf), bytes: buf.length, state_sha256: stateSha }].slice(-KEEP_DIFFS);
      Object.assign(result, { diffBytes: buf.length, changedCompanies: Object.keys(diff.changes).length + diff.removed.length });
    } else {
      // Never publish a change file that doesn't add up: apps take the full copy instead.
      diffs = [];
      result.note = "change file didn't reproduce this run's feed; published the full copy only";
    }
  } else {
    result.note = "no saved feed from the previous run: published the full copy only";
  }

  const manifest: FeedManifestV2 = {
    schema,
    seq,
    generated_at: generated,
    state_sha256: stateSha,
    companies: Object.keys(state.jobs).length,
    jobs: Object.values(state.jobs).reduce((n, r) => n + r.length, 0),
    snapshot: { file: snapFile, sha256: sha(snapBuf), bytes: snapBuf.length },
    diffs,
  };
  writeFileSync(join(out, MANIFEST(format)), `${JSON.stringify(manifest, null, 2)}\n`);
  // Locally keep only this run's files (its snapshot is the next run's "previous"); older ones live in the release.
  const current = new Set([snapFile, diffFile]);
  const mine = new RegExp(`^jobs-v${format}-(snapshot|diff)-\\d+\\.(json|txt)\\.br$`);
  for (const f of readdirSync(out)) if (mine.test(f) && !current.has(f)) rmSync(join(out, f));
  return result;
}

export const writeFeedV2 = (out: string, state: FeedState, generated: string) => writeFeed(out, state, generated, 2);
