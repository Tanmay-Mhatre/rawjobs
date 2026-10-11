/**
 * The release gate: run before every upload to the directory's latest release, so a broken or
 * shrunken directory never reaches the installs that download it.
 *
 * Compares the candidate (dist/manifest.json plus the files publish.ts wrote) with the live
 * release's manifest. A run that times out or loses a source must fail here, not ship.
 *
 *   pnpm exec tsx scripts/catalog/guard.ts --prev prev-manifest.json [--dist dist] [--data dist-data]
 *   ALLOW_SHRINK=1 lifts the two shrink rules (a deliberate purge), never the others.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectoryManifest } from "./release";

/** A candidate below these shares of the live release is refused (unless shrinking is allowed). */
export const MIN_COMPANIES_SHARE = 0.9;
export const MIN_INDEXED_SHARE = 0.85;
/** Never publish a directory smaller than this, whatever the baseline. */
export const MIN_COMPANIES = 20_000;
export const MIN_INDEXED = 10_000;
/** A few boards without a careers link are known (successfactors:flocorpprd); many means a broken build. */
export const MAX_NO_CAREERS_URL_SHARE = 0.01;

export type Counts = Pick<DirectoryManifest, "companies" | "indexed">;
export type Row = { key?: string; ats?: string; slug?: string; name?: string; careers_url?: string };
export type Candidate = { manifest: Counts; directory: { count: number; companies: Row[] }; index: { count: number; companies: { key?: string }[] } };
export type Verdict = { ok: boolean; reasons: string[]; warnings: string[] };

export function gate(prev: Counts | null, next: Candidate, allowShrink = false): Verdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const { manifest, directory, index } = next;
  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;

  if (prev) {
    const shrinks = [
      manifest.companies < MIN_COMPANIES_SHARE * prev.companies && `companies ${manifest.companies} is ${pct(manifest.companies, prev.companies)} of the live ${prev.companies} (minimum ${MIN_COMPANIES_SHARE * 100}%)`,
      manifest.indexed < MIN_INDEXED_SHARE * prev.indexed && `indexed ${manifest.indexed} is ${pct(manifest.indexed, prev.indexed)} of the live ${prev.indexed} (minimum ${MIN_INDEXED_SHARE * 100}%)`,
    ].filter((s): s is string => !!s);
    if (allowShrink) warnings.push(...shrinks.map((s) => `allowed shrink: ${s}`));
    else reasons.push(...shrinks);
  }
  if (manifest.companies < MIN_COMPANIES) reasons.push(`companies ${manifest.companies} is under the floor of ${MIN_COMPANIES}`);
  if (manifest.indexed < MIN_INDEXED) reasons.push(`indexed ${manifest.indexed} is under the floor of ${MIN_INDEXED}`);

  if (manifest.companies !== directory.count || directory.count !== directory.companies.length)
    reasons.push(`directory counts disagree: manifest ${manifest.companies}, file ${directory.count}, rows ${directory.companies.length}`);
  if (manifest.indexed !== index.count || index.count !== index.companies.length) reasons.push(`index counts disagree: manifest ${manifest.indexed}, file ${index.count}, rows ${index.companies.length}`);

  const keys = new Set<string>();
  const dupes = new Set<string>();
  let incomplete = 0;
  let noCareersUrl = 0;
  for (const r of directory.companies) {
    if (!r.key || !r.ats || !r.slug || !r.name) incomplete++;
    if (!r.careers_url) noCareersUrl++;
    if (r.key && keys.has(r.key)) dupes.add(r.key);
    if (r.key) keys.add(r.key);
  }
  if (dupes.size) reasons.push(`${dupes.size} duplicate keys, e.g. ${[...dupes].slice(0, 3).join(", ")}`);
  if (incomplete) reasons.push(`${incomplete} rows missing key, ats, slug or name`);
  if (noCareersUrl) {
    const msg = `${noCareersUrl} rows without a careers_url`;
    if (noCareersUrl > MAX_NO_CAREERS_URL_SHARE * directory.companies.length) reasons.push(`${msg} (over ${MAX_NO_CAREERS_URL_SHARE * 100}%)`);
    else warnings.push(msg);
  }
  const orphans = index.companies.filter((c) => !c.key || !keys.has(c.key));
  if (orphans.length) reasons.push(`${orphans.length} indexed companies not in the directory, e.g. ${orphans.slice(0, 3).map((c) => c.key).join(", ")}`);

  return { ok: reasons.length === 0, reasons, warnings };
}

function main() {
  const arg = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1]! : fallback;
  };
  const prevFile = arg("--prev");
  if (prevFile === undefined) throw new Error("--prev <file> is required (an empty file means there is no live release yet)");
  const dist = resolve(arg("--dist", "dist")!);
  const data = resolve(arg("--data", "dist-data")!);
  const prevText = existsSync(prevFile) ? readFileSync(prevFile, "utf8").trim() : "";
  const prev = prevText ? (JSON.parse(prevText) as Counts) : null;
  const read = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
  const candidate: Candidate = {
    manifest: read<Counts>(join(dist, "manifest.json")),
    directory: read(join(data, "catalog", "directory.json")),
    index: read(join(data, "catalog", "index.json")),
  };
  const allowShrink = process.env.ALLOW_SHRINK === "1" || process.env.ALLOW_SHRINK === "true";
  const v = gate(prev, candidate, allowShrink);

  for (const w of v.warnings) console.log(`::warning::${w}`);
  for (const r of v.reasons) console.log(`::error::${r}`);
  const row = (label: string, a: number | undefined, b: number) => `| ${label} | ${a ?? "–"} | ${b} |`;
  const summary = [
    `### Release gate: ${v.ok ? "PASS" : "REFUSED"}`,
    "",
    "| | Live | Candidate |",
    "|---|---|---|",
    row("Companies", prev?.companies, candidate.manifest.companies),
    row("Indexed", prev?.indexed, candidate.manifest.indexed),
    "",
    ...v.reasons.map((r) => `- **Refused:** ${r}`),
    ...v.warnings.map((w) => `- Warning: ${w}`),
    allowShrink ? "- Shrinking was allowed for this run (allow_shrink)." : "",
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(`Release gate: ${v.ok ? "PASS" : "REFUSED"} (companies ${prev?.companies ?? "–"} -> ${candidate.manifest.companies}, indexed ${prev?.indexed ?? "–"} -> ${candidate.manifest.indexed})`);
  if (!v.ok) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
