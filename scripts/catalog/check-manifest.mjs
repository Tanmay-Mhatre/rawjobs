#!/usr/bin/env node
// The signing job's last check before it signs: refuse a manifest that's odd or older than the one
// already published. A poisoned or broken producer job can then at worst fail a run, visibly; it can't
// get an old or oversized release signed (rollback and freeze, docs/plans/team-review-2026-11).
//
//   node scripts/catalog/check-manifest.mjs [--dir <dir>] <candidate> [--live <file>] [<candidate> [--live <file>] ...]
//
// Each candidate is a manifest (the directory's manifest.json, the job feed's jobs-*manifest.json) or
// the topic word list (concepts.json). --live after a candidate names the live copy it must be newer
// than (missing or empty: nothing published yet, so only the format and size rules apply). --dir: the
// listed files that are in this folder must match the manifest's size and SHA-256 (files published by
// earlier runs, such as older change files, aren't there and are skipped).
//
// Newer means: a later `published_at ?? generated_at` (an equal one is "nothing new"), and for the job
// feed's second and third formats no lower `seq`. The word list has only a date (`version`), so
// there an equal date passes and only an older one is refused.
//
// Plain Node with no imports outside node:, on purpose: it runs in the signing job, where nothing
// from node_modules may run while the key is loaded.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const LIMITS = {
  // The manifest itself: the job feed's first format lists one shard per hiring system, a few KB.
  manifestBytes: 5 * 1024 * 1024,
  files: 500,
  // GitHub's limit for one release asset is 2 GiB.
  fileBytes: 2 * 1024 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024 * 1024,
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Every file a manifest points to, as { name, sha256, bytes }. */
export function filesOf(m) {
  const out = [];
  const add = (name, f) => out.push({ name: name ?? f?.file, sha256: f?.sha256, bytes: f?.bytes });
  if (m.files && typeof m.files === "object") for (const [name, f] of Object.entries(m.files)) add(name, f);
  if (m.shards && typeof m.shards === "object") for (const f of Object.values(m.shards)) add(undefined, f);
  if (m.snapshot) add(undefined, m.snapshot);
  if (Array.isArray(m.diffs)) for (const f of m.diffs) add(undefined, f);
  if (m.activity) add(undefined, m.activity);
  return out;
}

/** The time a copy counts as published: a restamped rollback's published_at, else generated_at. */
const stampOf = (m) => m.published_at ?? m.generated_at;

/**
 * Problems with `candidate` (parsed JSON, `bytes` its size) against `live` (parsed, or undefined).
 * `dir`: the folder holding the files it lists, to check those that are there.
 */
export function check(candidate, { bytes = 0, live, dir } = {}) {
  const problems = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return ["isn't a JSON object"];
  if (bytes > LIMITS.manifestBytes) problems.push(`is ${bytes} bytes, over the ${LIMITS.manifestBytes} limit`);

  const isWordList = candidate.concepts !== undefined && candidate.generated_at === undefined;
  if (isWordList) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(candidate.version ?? ""))) problems.push("has no YYYY-MM-DD version");
    // An empty list is valid: the eval gate can keep every candidate word out.
    if (typeof candidate.concepts !== "object" || candidate.concepts === null || Array.isArray(candidate.concepts)) problems.push("has no topic table");
    if (live?.version && String(candidate.version) < String(live.version)) problems.push(`is older (${candidate.version}) than the live copy (${live.version})`);
    return problems;
  }

  const stamp = stampOf(candidate);
  if (typeof stamp !== "string" || Number.isNaN(Date.parse(stamp))) {
    problems.push("has no valid generated_at");
  } else {
    if (Date.parse(stamp) > Date.now() + 60 * 60 * 1000) problems.push(`is dated in the future (${stamp})`);
    const liveStamp = live && stampOf(live);
    if (liveStamp && !Number.isNaN(Date.parse(liveStamp))) {
      const d = Date.parse(stamp) - Date.parse(liveStamp);
      if (d < 0) problems.push(`is older (${stamp}) than the live copy (${liveStamp})`);
      else if (d === 0) problems.push(`is the same copy as the live one (${stamp}): nothing new to sign`);
    }
  }
  if (candidate.seq !== undefined && !Number.isInteger(candidate.seq)) problems.push("has a seq that isn't a whole number");
  if (Number.isInteger(live?.seq) && Number.isInteger(candidate.seq) && candidate.seq < live.seq) problems.push(`goes back to #${candidate.seq} (live: #${live.seq})`);

  const files = filesOf(candidate);
  if (!files.length) problems.push("lists no files");
  if (files.length > LIMITS.files) problems.push(`lists ${files.length} files, over the ${LIMITS.files} limit`);
  let total = 0;
  for (const f of files) {
    if (typeof f.name !== "string" || !SAFE_NAME.test(f.name)) {
      problems.push(`lists a file with an odd name (${JSON.stringify(f.name)})`);
      continue;
    }
    if (typeof f.sha256 !== "string" || !SHA256.test(f.sha256)) problems.push(`${f.name}: no valid sha256`);
    if (!Number.isInteger(f.bytes) || f.bytes <= 0) problems.push(`${f.name}: no valid size`);
    else if (f.bytes > LIMITS.fileBytes) problems.push(`${f.name}: ${f.bytes} bytes, over the ${LIMITS.fileBytes} limit`);
    else total += f.bytes;
    const path = dir && join(dir, f.name);
    if (path && existsSync(path)) {
      if (statSync(path).size !== f.bytes) problems.push(`${f.name}: the manifest says ${f.bytes} bytes, the file has ${statSync(path).size}`);
      else if (createHash("sha256").update(readFileSync(path)).digest("hex") !== f.sha256) problems.push(`${f.name}: SHA-256 doesn't match the manifest`);
    }
  }
  if (total > LIMITS.totalBytes) problems.push(`lists ${total} bytes in all, over the ${LIMITS.totalBytes} limit`);
  return problems;
}

const readJson = (path) => {
  const raw = readFileSync(path);
  try {
    return { json: JSON.parse(raw.toString("utf8")), bytes: raw.length };
  } catch {
    return { json: undefined, bytes: raw.length };
  }
};

function main() {
  const args = process.argv.slice(2);
  let dir;
  const pairs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") dir = args[++i];
    else if (args[i] === "--live") {
      if (!pairs.length) throw new Error("--live comes after the candidate it belongs to");
      pairs[pairs.length - 1].live = args[++i];
    } else pairs.push({ file: args[i] });
  }
  if (!pairs.length) {
    console.error("Usage: node scripts/catalog/check-manifest.mjs [--dir <dir>] <candidate> [--live <file>] ...");
    process.exit(2);
  }
  let failed = false;
  for (const { file, live } of pairs) {
    if (!existsSync(file)) {
      console.error(`::error::${file}: missing`);
      failed = true;
      continue;
    }
    const c = readJson(file);
    const l = live && existsSync(live) && statSync(live).size > 0 ? readJson(live).json : undefined;
    const problems = c.json === undefined ? ["isn't valid JSON"] : check(c.json, { bytes: c.bytes, live: l, dir });
    for (const p of problems) console.error(`::error::${file} ${p}`);
    if (problems.length) failed = true;
    else console.log(`${file}: OK (${c.json.published_at ?? c.json.generated_at ?? c.json.version}${l ? `; live: ${l.published_at ?? l.generated_at ?? l.version}` : "; nothing live yet"})`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
