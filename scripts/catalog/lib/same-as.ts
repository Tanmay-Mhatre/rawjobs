/**
 * Boards of one company on several hiring systems (Doctolib on Ashby and Greenhouse), for the
 * directory's `same_as`. Same-name boards are mostly *different* companies (Linear, Harvey, Hive…), so
 * a name alone never joins two: they must also list the same jobs. Joined only when the names are equal
 * (legal forms off, "Technologies", "Group" and "Labs" kept) and they share at least 3 job titles that
 * make up at least half of the smaller board, or at least 5. Titles are compared exactly, after the
 * Radar's clean-up (roleKey: places, gender tags and requisition ids off, "Sr." is "Senior").
 */
import { companyNameKey, roleKey } from "@rawjobs/core/dashboard";

export type SameAsBoard = { key: string; name: string; open_jobs?: number | null; titles: readonly string[] };

export const MIN_SHARED = 3;
export const MIN_SHARE = 0.5;
export const ENOUGH_SHARED = 5;

function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const t of small) if (big.has(t)) shared++;
  return shared >= ENOUGH_SHARED || (shared >= MIN_SHARED && shared >= MIN_SHARE * small.size);
}

/** Board key -> the key every board of that company shares (the one with the most open jobs). Only joined boards are listed. */
export function sameAsLinks(boards: readonly SameAsBoard[]): Map<string, string> {
  const byName = new Map<string, SameAsBoard[]>();
  for (const b of boards) {
    if (!b.titles.length) continue;
    const n = companyNameKey(b.name);
    byName.set(n, [...(byName.get(n) ?? []), b]);
  }
  const out = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const titles = group.map((b) => new Set(b.titles.map(roleKey)));
    // Union-find over the pairs that list the same jobs.
    const parent = group.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) if (overlaps(titles[i]!, titles[j]!)) parent[find(j)] = find(i);
    const components = new Map<number, SameAsBoard[]>();
    for (let i = 0; i < group.length; i++) components.set(find(i), [...(components.get(find(i)) ?? []), group[i]!]);
    for (const members of components.values()) {
      if (members.length < 2) continue;
      const lead = [...members].sort((a, b) => (b.open_jobs ?? b.titles.length) - (a.open_jobs ?? a.titles.length) || a.key.localeCompare(b.key))[0]!;
      for (const m of members) out.set(m.key, lead.key);
    }
  }
  return out;
}
