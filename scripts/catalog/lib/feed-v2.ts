/**
 * The job feed's second format (packages/core/src/job-feed-diff.ts): a full copy plus a change file per
 * day, so apps that are up to date download only what changed. Written next to the first format while
 * apps move over.
 *
 * In <out>: jobs-v2-snapshot-<seq>.json.br (full copy), jobs-v2-diff-<seq>.json.br (today's changes),
 * jobs-v2-manifest.json (upload it last). Yesterday's snapshot and manifest must be in <out> (the feed's
 * saved state) for a change file to be made; without them, apps download the full copy once.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { applyFeedDiff, diffFeedStates, feedStateHash, JOB_FEED_SCHEMA_V2, type FeedManifestV2, type FeedRow, type FeedSnapshot, type FeedState } from "../../../packages/core/src/index";

/** Change files kept in the manifest: an app more than this many days behind downloads the full copy. */
export const KEEP_DIFFS = 14;
const MANIFEST = "jobs-v2-manifest.json";

const brotli = (s: string) => brotliCompressSync(s, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: s.length } });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Today's companies (from the first format's shards) as a state: rows by id, day last read. */
export function stateOf(companies: Record<string, { fetched_at: string; jobs: FeedRow[] }>): FeedState {
  const state: FeedState = { verified: {}, jobs: {} };
  for (const [key, c] of Object.entries(companies)) {
    state.verified[key] = c.fetched_at.slice(0, 10);
    // One row per job id: a change file names jobs by id.
    state.jobs[key] = [...new Map(c.jobs.map((r) => [r[0], r])).values()];
  }
  return state;
}

function readPrevious(out: string): { manifest: FeedManifestV2; state: FeedState } | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(out, MANIFEST), "utf8")) as FeedManifestV2;
    const file = join(out, manifest.snapshot.file);
    if (manifest.schema !== JOB_FEED_SCHEMA_V2 || !existsSync(file)) return undefined;
    const snap = JSON.parse(brotliDecompressSync(readFileSync(file)).toString("utf8")) as FeedSnapshot;
    return { manifest, state: { verified: snap.verified, jobs: snap.jobs } };
  } catch {
    return undefined;
  }
}

export type V2Result = { seq: number; snapshotBytes: number; diffBytes?: number; changedCompanies?: number; note?: string };

export function writeFeedV2(out: string, state: FeedState, generated: string): V2Result {
  const prev = readPrevious(out);
  const seq = (prev?.manifest.seq ?? 0) + 1;
  const stateSha = feedStateHash(state);
  const snapshot: FeedSnapshot = { schema: JOB_FEED_SCHEMA_V2, seq, generated_at: generated, ...state };
  const snapBuf = brotli(JSON.stringify(snapshot));
  const snapFile = `jobs-v2-snapshot-${seq}.json.br`;
  writeFileSync(join(out, snapFile), snapBuf);

  const result: V2Result = { seq, snapshotBytes: snapBuf.length };
  let diffs = prev?.manifest.diffs ?? [];
  if (prev) {
    const diff = diffFeedStates(prev.state, state, { seq, generated_at: generated, date: generated.slice(0, 10) });
    // Check the change file before publishing it: yesterday's copy plus it must be today's copy exactly.
    const check: FeedState = { verified: { ...prev.state.verified }, jobs: { ...prev.state.jobs } };
    applyFeedDiff(check, diff);
    if (feedStateHash(check) === stateSha) {
      const buf = brotli(JSON.stringify(diff));
      const file = `jobs-v2-diff-${seq}.json.br`;
      writeFileSync(join(out, file), buf);
      diffs = [...diffs, { seq, file, sha256: sha(buf), bytes: buf.length, state_sha256: stateSha }].slice(-KEEP_DIFFS);
      Object.assign(result, { diffBytes: buf.length, changedCompanies: Object.keys(diff.changes).length + diff.removed.length });
    } else {
      // Never publish a change file that doesn't add up: apps take the full copy instead.
      diffs = [];
      result.note = "change file didn't reproduce today's feed; published the full copy only";
    }
  } else {
    result.note = "no saved v2 feed from yesterday: published the full copy only";
  }

  const manifest: FeedManifestV2 = {
    schema: JOB_FEED_SCHEMA_V2,
    seq,
    generated_at: generated,
    state_sha256: stateSha,
    companies: Object.keys(state.jobs).length,
    jobs: Object.values(state.jobs).reduce((n, r) => n + r.length, 0),
    snapshot: { file: snapFile, sha256: sha(snapBuf), bytes: snapBuf.length },
    diffs,
  };
  writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  // Locally keep only today's files (today's snapshot is the next run's "yesterday"); older change files live in the release.
  const today = new Set([snapFile, `jobs-v2-diff-${seq}.json.br`]);
  for (const f of readdirSync(out)) if (/^jobs-v2-(snapshot|diff)-\d+\.json\.br$/.test(f) && !today.has(f)) rmSync(join(out, f));
  return result;
}
