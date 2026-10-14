import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LocationCache, ResolvedLocation } from "./run";

/** Jobs kept in the cache: the newest ones, as a job id's place never changes and old ids close. */
const MAX_ENTRIES = 100_000;

const fileOf = (dataDir: string) => join(dataDir, "cache", "locations.json");

/**
 * Where jobs listed only as "3 Locations" (Workday) really are, by job id: data/cache/locations.json.
 * Each such job's detail page is then fetched once, not on every scan.
 */
export function readLocationCache(dataDir: string): LocationCache {
  try {
    const file = fileOf(dataDir);
    if (!existsSync(file)) return new Map();
    const saved = JSON.parse(readFileSync(file, "utf8")) as { version: 1; jobs: Record<string, ResolvedLocation> };
    return new Map(Object.entries(saved.jobs ?? {}));
  } catch {
    // Lost only costs fetching those pages again.
    return new Map();
  }
}

/** Save the cache when it grew since it was read (`before`: its size then), newest entries kept. */
export function writeLocationCache(dataDir: string, cache: LocationCache, before: number): void {
  if (cache.size === before) return;
  const entries = [...cache].slice(-MAX_ENTRIES);
  const file = fileOf(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, jobs: Object.fromEntries(entries) }));
}
