import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

/**
 * Fails when a lockfile change adds a package version published less than a week ago.
 *
 *   tsx scripts/ci/lockfile-age.ts <base-lockfile> <head-lockfile>
 *
 * CI runs it on Dependabot pull requests. pnpm's `minimumReleaseAge` should already stop such
 * versions; this checks that Dependabot's own pnpm honoured it, transitive versions included.
 */

export const MIN_AGE_DAYS = 7;

/** The `name@version` entries of a pnpm lockfile's `packages:` section. */
export function lockedVersions(lockfile: string): Set<string> {
  const packages = (parse(lockfile) as { packages?: Record<string, unknown> } | null)?.packages ?? {};
  return new Set(Object.keys(packages));
}

/** Splits `name@version` (also `@scope/name@version`). Null for anything not from the registry. */
export function splitKey(key: string): { name: string; version: string } | null {
  const at = key.indexOf("@", 1);
  if (at < 0) return null;
  const name = key.slice(0, at);
  const version = key.slice(at + 1).replace(/\(.*$/, "");
  return /^\d+\.\d+\.\d+/.test(version) ? { name, version } : null;
}

/** The registry versions the head lockfile has and the base one doesn't. */
export function addedVersions(base: string, head: string): { name: string; version: string }[] {
  const before = lockedVersions(base);
  return [...lockedVersions(head)]
    .filter((k) => !before.has(k))
    .map(splitKey)
    .filter((v): v is { name: string; version: string } => v !== null);
}

/** The added versions younger than the minimum age, or with no publish time at all. */
export function tooYoung(added: { name: string; version: string; published?: string }[], now: Date, days = MIN_AGE_DAYS) {
  const limit = now.getTime() - days * 24 * 60 * 60 * 1000;
  return added.filter((v) => !v.published || Date.parse(v.published) > limit);
}

/** Every version's publish time for one package: one registry read per name, retried on 429 and 5xx. */
async function publishTimes(name: string): Promise<Record<string, string>> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, { headers: { accept: "application/json" } });
    if (res.ok) return ((await res.json()) as { time?: Record<string, string> }).time ?? {};
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${name}: registry answered ${res.status}`);
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

/** `work` over `items`, at most `limit` at a time, results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]!);
      }
    }),
  );
  return out;
}

async function main([basePath, headPath]: string[]) {
  if (!basePath || !headPath) throw new Error("usage: lockfile-age.ts <base-lockfile> <head-lockfile>");
  const added = addedVersions(readFileSync(basePath, "utf8"), readFileSync(headPath, "utf8"));
  // One read per package name, 6 at a time: a big group bump adds dozens of versions.
  const names = [...new Set(added.map((v) => v.name))];
  const times = new Map(names.map((n, i) => [n, i] as const));
  const byName = await mapLimit(names, 6, publishTimes);
  const timed = added.map((v) => ({ ...v, published: byName[times.get(v.name)!]![v.version] }));
  for (const v of timed) console.log(`${v.name}@${v.version}  published ${v.published ?? "(unknown)"}`);
  const young = tooYoung(timed, new Date());
  if (young.length) {
    console.error(`\nThese versions are younger than ${MIN_AGE_DAYS} days (or have no publish time):`);
    for (const v of young) console.error(`  ${v.name}@${v.version}  ${v.published ?? "(unknown)"}`);
    process.exit(1);
  }
  console.log(`\n${added.length} added version(s), all at least ${MIN_AGE_DAYS} days old.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
