import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  addedCounts,
  defaultDataDir,
  companyKey,
  loadConfig,
  companyExtras,
  suggestCompanies,
  suggestCompaniesCached,
  readDirectory,
  ProfileSchema,
  type Config,
  type IndexedCompany,
} from "@rawjobs/core";
import { readStdin } from "../util";

/** Remember boards found by "Add by link" that the directory doesn't have yet. */
export type SuggestInput = { profile?: unknown; watched?: string[]; hidden?: string[] };

export async function cmdCompanies(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      data: { type: "string", short: "d", default: defaultDataDir() },
      limit: { type: "string", short: "n", default: "30" },
      json: { type: "boolean", default: false },
      stdin: { type: "boolean", default: false },
      /** Work the ranking out again instead of reading it from data/cache/suggestions/. */
      "no-cache": { type: "boolean", default: false },
    },
  });
  if (positionals[0] !== "suggest") {
    console.error("Usage: rawjobs companies suggest [--json] [--limit n]");
    return 2;
  }
  const indexFile = resolve(values.data, "catalog", "index.json");
  if (!existsSync(indexFile)) {
    const msg = "No company index yet. Build it with: pnpm catalog:refresh";
    if (values.json) console.log(JSON.stringify({ error: msg, hiringNow: [], worthWatching: [], scanned: 0 }));
    else console.error(msg);
    return values.json ? 0 : 1;
  }
  // The dashboard sends the profile being edited (maybe not saved yet) and the companies to leave out.
  const input: SuggestInput = values.stdin ? (JSON.parse((await readStdin()) || "{}") as SuggestInput) : {};
  const sent = input.profile ? ProfileSchema.safeParse(input.profile) : undefined;
  let config: Config | undefined;
  try {
    config = loadConfig(values.config).config;
  } catch (err) {
    if (!sent?.success) throw err;
  }
  const profile = sent?.success ? sent.data : config!.profile;
  const index = JSON.parse(readFileSync(indexFile, "utf8")) as { generated_at: string; companies: IndexedCompany[] };
  const directory = readDirectory(values.data);
  // Directory companies without job rows (no openings, or not indexed): candidates to watch.
  const others = directory.filter((c) => !c.indexed);
  // Leave out companies already watched and ones the user said no to.
  const watched = new Set((input.watched ?? config?.companies.map(companyKey) ?? []).map((k) => k.toLowerCase()));
  const skip = new Set([...(input.hidden ?? []), ...(config?.companies_muted ?? [])].map((k) => k.toLowerCase()));
  const exclude = new Set([...watched, ...skip]);
  const started = Date.now();
  const limit = Number(values.limit) || 30;
  // A deep pool for lookalikes and packs; the lists shown are its first `limit` (same order).
  const opts = { exclude, mine: new Set([...watched].filter((k) => !skip.has(k))), others, limit: 400, indexGeneratedAt: new Date(index.generated_at) };
  const files = ["index.json", "directory.json", "additions.json"].map((f) => resolve(values.data, "catalog", f));
  const { result: pool, cached } = values["no-cache"]
    ? { result: suggestCompanies(profile, index.companies, opts), cached: false }
    : suggestCompaniesCached(profile, index.companies, { ...opts, dataDir: values.data, files });
  const result = { hiringNow: pool.hiringNow.slice(0, limit), worthWatching: pool.worthWatching.slice(0, limit), notScannable: pool.notScannable.slice(0, limit), scanned: pool.scanned };
  const extra = companyExtras(profile, pool, index.companies, directory, exclude);
  if (values.json) {
    // What each list left out because it's in My companies (counted where they're left out).
    const added = addedCounts(profile, pool.mine ?? { hiringNow: [], worthWatching: [], notScannable: [] }, index.companies, directory);
    console.log(JSON.stringify({ ...result, ...extra, added, index_generated_at: index.generated_at, took_ms: Date.now() - started, cached }));
    return 0;
  }
  console.log(`Scanned ${result.scanned} companies in ${Date.now() - started} ms (index from ${index.generated_at.slice(0, 10)}).\n`);
  console.log("Hiring for you now:");
  for (const s of result.hiringNow) console.log(`  ${String(s.score).padStart(3)}  ${s.name} (${s.ats}) · ${s.reasons.join(" · ")}\n        e.g. ${s.examples.join(" | ")}`);
  console.log("\nWorth watching:");
  for (const s of result.worthWatching) console.log(`  ${String(s.score).padStart(3)}  ${s.name} (${s.ats}) · ${s.reasons.join(" · ")}`);
  if (result.notScannable.length) {
    console.log("\nIn your industries, not scannable yet:");
    for (const s of result.notScannable) console.log(`       ${s.name} (${s.ats}) · ${s.reasons.join(" · ")}`);
  }
  return 0;
}
