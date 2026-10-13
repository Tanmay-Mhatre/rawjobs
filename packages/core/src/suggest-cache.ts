import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic";
import { APP_VERSION, BUNDLED, CODE_ROOT } from "./runtime";
import type { Profile } from "./schema";
import {
  BIG_COMPANY_JOBS,
  type CompanySuggestion,
  type IndexedCompany,
  type PickOptions,
  pickSuggestions,
  type RankedSuggestions,
  type RankOptions,
  rankCompanies,
  type SuggestResult,
} from "./suggest";

/**
 * Company suggestions read every job row in the index (420,000 of them): seconds of work that only
 * depends on the profile, the index, the directory and the day. So the ranking is kept on disk, in
 * data/cache/suggestions/, and the companies to leave out (yours, hidden, muted) are taken out
 * after: a restart, adding a company or hiding one doesn't redo it.
 */

/** Bump when rankCompanies' output changes in a way the code stamp wouldn't catch. */
const FORMAT = 1;
/** Rankings kept on disk (one per profile and day, more or less). */
const KEEP_FILES = 6;
/**
 * Companies kept per list. Deep enough that leaving out your own companies still fills a 400-deep
 * pool; when it doesn't, the ranking is worked out again in full.
 */
export const RANKED_KEEP = 2000;

/** Where cached suggestions live. */
export const suggestCacheDir = (dataDir: string) => join(dataDir, "cache", "suggestions");

let codeStampMemo: string | undefined;
/**
 * Which code made a cached answer: the version for an installed copy; for a checkout (where the
 * version doesn't change with every edit), when its core sources last changed.
 */
export function codeStamp(): string {
  if (codeStampMemo) return codeStampMemo;
  if (BUNDLED) return (codeStampMemo = APP_VERSION);
  let newest = 0;
  const src = join(CODE_ROOT, "packages", "core", "src");
  try {
    for (const f of readdirSync(src, { recursive: true, encoding: "utf8" })) if (f.endsWith(".ts")) newest = Math.max(newest, statSync(join(src, f)).mtimeMs);
  } catch {
    // No sources to read: the version alone.
  }
  return (codeStampMemo = `${APP_VERSION}+${newest}`);
}

/** A file's size and change time, or "-" when it's missing: changes whenever the file does. */
export function fileStamp(path: string): string {
  try {
    const s = statSync(path);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "-";
  }
}

const hash = (parts: unknown) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

/** Keep the newest `keep` files whose names start with `prefix`. */
export function pruneCache(dir: string, prefix: string, keep = KEEP_FILES): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) rmSync(join(dir, f), { force: true });
  } catch {
    // Another process pruning at the same time: nothing lost.
  }
}

/** Read a cache file; a missing or damaged one is a miss (and a damaged one is removed). */
export function readCacheFile<T>(file: string): T | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    rmSync(file, { force: true });
    return undefined;
  }
}

/** Write a cache file; a full disk or a read-only folder only costs the cache. */
export function writeCacheFile(dir: string, file: string, text: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(file, text);
  } catch {
    // Not cached this time.
  }
}

export type CachedOptions = RankOptions &
  PickOptions & {
    dataDir: string;
    /** The files the ranking reads besides the profile: a change to any is a new ranking. */
    files: readonly string[];
    /** Companies kept per list (RANKED_KEEP; smaller in tests). */
    keep?: number;
  };

type Kept = RankedSuggestions & { cut: { hiringNow: boolean; worthWatching: boolean; notScannable: boolean } };

/**
 * suggestCompanies, with the ranking kept on disk. `files` are the inputs the ranking reads besides
 * the profile (the index, the directory, your additions): any change to one is a new ranking.
 * Rankings are per UTC day too, since postings age ("new this week", stale after six months).
 */
export function suggestCompaniesCached(profile: Profile, companies: readonly IndexedCompany[], opts: CachedOptions): { result: SuggestResult; cached: boolean } {
  const now = opts.now ?? new Date();
  const o = { ...opts, now };
  const dir = suggestCacheDir(opts.dataDir);
  const key = hash([FORMAT, codeStamp(), now.toISOString().slice(0, 10), opts.indexGeneratedAt?.toISOString() ?? null, opts.files.map(fileStamp), [...(opts.supported ?? [])], profile]);
  const file = join(dir, `ranked-${key}.json`);
  const kept = readCacheFile<Kept>(file);
  if (kept) {
    const result = pickSuggestions(kept, companies, o);
    if (fillsLimit(kept, result, opts)) return { result, cached: true };
  }
  const ranked = rankCompanies(profile, companies, o);
  const keep = opts.keep ?? RANKED_KEEP;
  const cut = (list: CompanySuggestion[]) => list.length > keep;
  const store: Kept = {
    hiringNow: ranked.hiringNow.slice(0, keep),
    worthWatching: ranked.worthWatching.slice(0, keep),
    notScannable: ranked.notScannable.slice(0, keep),
    scanned: ranked.scanned,
    cut: { hiringNow: cut(ranked.hiringNow), worthWatching: cut(ranked.worthWatching), notScannable: cut(ranked.notScannable) },
  };
  writeCacheFile(dir, file, JSON.stringify(store));
  pruneCache(dir, "ranked-");
  return { result: pickSuggestions(ranked, companies, o), cached: false };
}

/**
 * Is the answer from a cut ranking the same as from the whole one? Yes when every cut list still
 * has `limit` companies once yours are left out, not counting the large employers the diversity
 * rule may hold back to the end (those ranked lower are in the part that was cut).
 */
function fillsLimit(kept: Kept, result: SuggestResult, opts: PickOptions): boolean {
  const limit = opts.limit ?? 30;
  return (["hiringNow", "worthWatching", "notScannable"] as const).every((k) => {
    if (!kept.cut[k]) return true;
    const left = kept[k].filter((s) => !opts.exclude?.has(s.key));
    const giants = left.filter((s) => (s.open_jobs ?? 0) > BIG_COMPANY_JOBS).length;
    return result[k].length === limit && left.length - giants >= limit;
  });
}
