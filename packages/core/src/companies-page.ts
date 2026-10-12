import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeFileAtomic } from "./atomic";
import { connectors } from "./connectors";
import { type CompanyShape, companyWords, lookalikes, matchEmployers, rolesFromResume, seedFromRole } from "./employers";
import type { CompanyCheck } from "./protocol";
import { readResume } from "./resume";
import { ATS_TYPES, type Profile } from "./schema";
import type { DirectoryEntry } from "./scope";
import type { IndexedCompany, SuggestResult } from "./suggest";

/**
 * The Companies page's data beyond the suggestion lists: boards added here (kept until the shared
 * directory has them) and the page's extras (past employers, lookalikes, packs, coverage).
 */

/** Companies in a starter pack, and the extras after them ("Next in this pack"). */
export const PACK_SIZE = 8;
export const PACK_MORE = 4;

const isAts = (ats: string | undefined) => (ATS_TYPES as readonly string[]).includes(ats ?? "");

/** Remember live boards you added that the shared directory doesn't have yet (catalog/additions.json). */
export function recordAdditions(dataDir: string, results: CompanyCheck[]): void {
  const fresh = results.filter((r) => (r.status === "live" || r.status === "dormant") && !r.in_directory && r.key && isAts(r.ats));
  if (!fresh.length) return;
  const file = resolve(dataDir, "catalog", "additions.json");
  const current = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { companies: (DirectoryEntry & { added_at: string })[] }).companies : [];
  const byKey = new Map(current.map((c) => [c.key, c]));
  for (const r of fresh) {
    byKey.set(r.key!, {
      key: r.key!,
      name: r.name!,
      ats: r.ats!,
      slug: r.slug!,
      ...(r.region ? { region: r.region } : {}),
      ...(r.shard ? { shard: r.shard } : {}),
      ...(r.site ? { site: r.site } : {}),
      careers_url: r.careers_url!,
      status: r.status,
      open_jobs: r.open_jobs ?? null,
      added_at: byKey.get(r.key!)?.added_at ?? new Date().toISOString(),
    });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify({ companies: [...byKey.values()] }, null, 1));
}

/**
 * What the Companies page shows beyond the three lists: your past employers in the directory
 * ("go back?"), companies like them, one starter pack per industry you picked, and how much of
 * your industries we can track.
 */
export function companyExtras(
  profile: Profile,
  pool: SuggestResult,
  indexed: readonly IndexedCompany[],
  directory: readonly DirectoryEntry[],
  exclude: ReadonlySet<string>,
  resumeText = readResume().text ?? "",
) {
  const candidates = [...pool.hiringNow, ...pool.worthWatching];
  const rowsByKey = new Map(indexed.map((c) => [c.key, c]));
  const dirByKey = new Map(directory.map((c) => [c.key, c]));
  const source = (key: string) => rowsByKey.get(key) ?? dirByKey.get(key);
  const shapes = new Map<string, CompanyShape>();

  // Past employers: the confirmed list, or (until there is one) what the resume says.
  const roles = rolesFromResume(resumeText);
  const names = profile.past_employers.length ? profile.past_employers : roles.map((r) => r.company);
  const matched = matchEmployers(names, directory);
  const roleOf = (name: string) => roles.find((r) => companyWords(r.company).join(" ") === companyWords(name).join(" "));
  const lookalikeRows = matched
    .map(({ name, match }) => {
      const role = roleOf(name);
      const seed = match ? { ...(rowsByKey.get(match.key) ?? match), name } : role ? seedFromRole(role) : undefined;
      return seed ? { seed: name, in_directory: !!match, items: lookalikes(seed, candidates, source, shapes, { limit: 6 }) } : undefined;
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.items.length > 0)
    .slice(0, 3);
  const pastEmployers = matched.map(({ name, match }) => ({
    name,
    ...(match && !exclude.has(match.key)
      ? {
          company: {
            key: match.key,
            name: match.name,
            ats: match.ats,
            slug: match.slug,
            careers_url: match.careers_url,
            region: match.region,
            shard: match.shard,
            site: match.site,
            open_jobs: match.open_jobs,
            status: match.status,
          },
        }
      : {}),
    watched: !!match && exclude.has(match.key),
  }));

  const wanted = new Set(profile.industries);
  // The best 8 per industry, and the next few ("more") the page shows one pick at a time.
  const packs = profile.industries.map((id) => {
    const ranked = candidates
      .filter((c) => c.industries.includes(id) && connectors[c.ats as keyof typeof connectors])
      .sort((a, b) => b.score - a.score)
      .slice(0, PACK_SIZE + PACK_MORE);
    return { industry: id, items: ranked.slice(0, PACK_SIZE), more: ranked.slice(PACK_SIZE) };
  });
  const inIndustries = directory.filter((c) => c.tags?.some((t) => wanted.has(t)));
  const coverage = {
    in_industries: new Set(inIndustries.map((c) => companyWords(c.name).join(" "))).size,
    trackable: new Set(inIndustries.filter((c) => c.status === "live" && connectors[c.ats as keyof typeof connectors]).map((c) => companyWords(c.name).join(" "))).size,
  };
  return { pastEmployers, lookalikes: lookalikeRows, packs: packs.filter((p) => p.items.length), coverage };
}
