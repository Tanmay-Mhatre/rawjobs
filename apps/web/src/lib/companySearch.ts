import { displayName } from "@rawjobs/core/display-name";
import MiniSearch from "minisearch";

type Named = { name: string; slug: string };
type Doc = { id: number; name: string; clean: string; slug: string };

/**
 * A company search index: MiniSearch (MIT) over name, clean name and slug, plus lower-case copies for exact
 * checks. The clean name is what we show (displayName: "Getrecharge.Com" shows as "Recharge"), so both find it.
 * Build once per directory.
 */
export type CompanyIndex<T extends Named> = {
  items: readonly T[];
  lower: { name: string; clean: string; slug: string; words: string[]; squashed: string }[];
  search: MiniSearch<Doc>;
};

const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");

export function companyIndex<T extends Named>(items: readonly T[]): CompanyIndex<T> {
  const search = new MiniSearch<Doc>({ fields: ["name", "clean", "slug"], searchOptions: { prefix: true, fuzzy: 0.2, combineWith: "AND", boost: { name: 2, clean: 2 } } });
  const cleans = items.map((c) => displayName(c.name, c.slug));
  search.addAll(items.map((c, id) => ({ id, name: c.name, clean: cleans[id]!, slug: c.slug })));
  const lower = items.map((c, i) => {
    const name = c.name.toLowerCase();
    const clean = cleans[i]!.toLowerCase();
    const slug = c.slug.toLowerCase();
    const words = [...new Set([...name.split(/[^\p{L}\p{N}]+/u), ...clean.split(/[^\p{L}\p{N}]+/u)])];
    return { name, clean, slug, words, squashed: `${squash(name)} ${squash(slug)}` };
  });
  return { items, lower, search };
}

/**
 * How well each company matches a search, best first:
 *   0 the exact name (raw or clean), 1 name, clean name or slug starts with it, 2 a word of the name does,
 *   3 contains it (spaces and dots ignored: "open ai" finds OpenAI), 4 a close spelling ("strpe" finds Stripe).
 * Companies that don't match are left out.
 */
export function companyMatches<T extends Named>(index: CompanyIndex<T>, q: string): Map<T, number> {
  const s = q.trim().toLowerCase();
  const out = new Map<T, number>();
  if (!s) return out;
  const compact = squash(s);
  index.lower.forEach((c, i) => {
    const rank =
      c.name === s || c.clean === s
        ? 0
        : c.name.startsWith(s) || c.clean.startsWith(s) || c.slug.startsWith(s)
          ? 1
          : c.words.some((w) => w.startsWith(s))
            ? 2
            : c.name.includes(s) || c.slug.includes(s) || (!!compact && c.squashed.includes(compact))
              ? 3
              : -1;
    if (rank >= 0) out.set(index.items[i]!, rank);
  });
  for (const hit of index.search.search(s)) {
    const c = index.items[hit.id as number]!;
    if (!out.has(c)) out.set(c, 4);
  }
  return out;
}
