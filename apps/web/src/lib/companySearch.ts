import { displayName } from "@rawjobs/core/display-name";
import MiniSearch from "minisearch";

type Named = { name: string; slug: string };
type Doc = { id: number; name: string; clean: string };

/**
 * A company search index: MiniSearch (MIT) over the name and the clean name, plus lower-case copies for
 * exact checks. The clean name is what we show (displayName: "Getrecharge.Com" shows as "Recharge"), so both
 * find it. Careers addresses (the slug) are never searched: "revolut" must not find Emporia Energy through
 * greenhouse.io/emporiarevolutionizinghomeenergy. Build once per directory.
 */
export type CompanyIndex<T extends Named> = {
  items: readonly T[];
  lower: { name: string; clean: string; words: string[]; squashed: string[] }[];
  search: MiniSearch<Doc>;
};

const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");
const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function companyIndex<T extends Named>(items: readonly T[]): CompanyIndex<T> {
  const search = new MiniSearch<Doc>({ fields: ["name", "clean"], searchOptions: { prefix: true, fuzzy: 0.2, combineWith: "AND" } });
  const cleans = items.map((c) => displayName(c.name, c.slug));
  search.addAll(items.map((c, id) => ({ id, name: c.name, clean: cleans[id]! })));
  const lower = items.map((c, i) => {
    const name = c.name.toLowerCase();
    const clean = cleans[i]!.toLowerCase();
    return { name, clean, words: [...new Set([...wordsOf(name), ...wordsOf(clean)])], squashed: [squash(name), squash(clean)] };
  });
  return { items, lower, search };
}

/** How a company matched a search (companyMatches), best first. */
export const MATCH = { exact: 0, starts: 1, word: 2, contains: 3, close: 4 } as const;

/**
 * How well a company name (raw or clean) matches a search, or -1 when it doesn't (no typo forgiveness):
 *   0 the exact name (spaces and dots ignored: "open ai" is OpenAI), 1 the name starts with it, 2 a word
 *   of the name does, 3 the name contains it.
 */
export function nameRank(q: string, ...names: string[]): number {
  const s = q.trim().toLowerCase();
  if (!s) return -1;
  const lower = names.map((n) => n.toLowerCase());
  const compact = squash(s);
  if (lower.some((n) => n === s || (!!compact && squash(n) === compact))) return MATCH.exact;
  if (lower.some((n) => n.startsWith(s))) return MATCH.starts;
  if (lower.some((n) => wordsOf(n).some((w) => w.startsWith(s)))) return MATCH.word;
  if (lower.some((n) => n.includes(s) || (!!compact && squash(n).includes(compact)))) return MATCH.contains;
  return -1;
}

/**
 * How well each company matches a search, best first (MATCH): the exact name (raw or clean, spaces and
 * dots ignored), then a name
 * that starts with it, then a word of the name that does, then a name that contains it, then a close
 * spelling ("strpe" finds Stripe). Only names count, never careers addresses. Companies that don't match
 * are left out.
 */
export function companyMatches<T extends Named>(index: CompanyIndex<T>, q: string): Map<T, number> {
  const s = q.trim().toLowerCase();
  const out = new Map<T, number>();
  if (!s) return out;
  const compact = squash(s);
  index.lower.forEach((c, i) => {
    const rank =
      c.name === s || c.clean === s || (!!compact && c.squashed.includes(compact))
        ? MATCH.exact
        : c.name.startsWith(s) || c.clean.startsWith(s)
          ? MATCH.starts
          : c.words.some((w) => w.startsWith(s))
            ? MATCH.word
            : c.name.includes(s) || c.clean.includes(s) || (!!compact && c.squashed.some((n) => n.includes(compact)))
              ? MATCH.contains
              : -1;
    if (rank >= 0) out.set(index.items[i]!, rank);
  });
  for (const hit of index.search.search(s)) {
    const c = index.items[hit.id as number]!;
    if (!out.has(c)) out.set(c, MATCH.close);
  }
  return out;
}
