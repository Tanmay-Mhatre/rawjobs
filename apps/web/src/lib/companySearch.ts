import MiniSearch from "minisearch";

type Named = { name: string; slug: string };
type Doc = { id: number; name: string; slug: string };

/** A company search index: MiniSearch (MIT) over name and slug, plus lower-case copies for exact checks. Build once per directory. */
export type CompanyIndex<T extends Named> = {
  items: readonly T[];
  lower: { name: string; slug: string; words: string[]; squashed: string }[];
  search: MiniSearch<Doc>;
};

const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");

export function companyIndex<T extends Named>(items: readonly T[]): CompanyIndex<T> {
  const search = new MiniSearch<Doc>({ fields: ["name", "slug"], searchOptions: { prefix: true, fuzzy: 0.2, combineWith: "AND", boost: { name: 2 } } });
  search.addAll(items.map((c, id) => ({ id, name: c.name, slug: c.slug })));
  const lower = items.map((c) => {
    const name = c.name.toLowerCase();
    const slug = c.slug.toLowerCase();
    return { name, slug, words: name.split(/[^\p{L}\p{N}]+/u), squashed: `${squash(name)} ${squash(slug)}` };
  });
  return { items, lower, search };
}

/**
 * How well each company matches a search, best first:
 *   0 the exact name, 1 name or slug starts with it, 2 a word of the name does,
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
      c.name === s
        ? 0
        : c.name.startsWith(s) || c.slug.startsWith(s)
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
