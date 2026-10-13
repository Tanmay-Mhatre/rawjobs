import { keyOf, type CompanyRef } from "./companies";
import type { CompanyRow } from "./setup";

/**
 * Starter packs and the tray at the bottom of the Companies page. The pack buttons and progress are
 * worked out from your companies (so a finished pack still offers Remove pack after a reload); the
 * tray remembers this visit only: the changes Undo walks back.
 * Nothing here is saved.
 */

/** A company in a pack: in My companies when its key (or the key its ref makes) is there. */
type Member = { key: string; ats: string; slug: string; shard?: string; site?: string };
export const isAdded = (watched: ReadonlySet<string>, c: Member) => watched.has(c.key) || watched.has(keyOf(c));

/** Every company in the packs once, in pack order: a company in two packs counts once. */
export function uniqueMembers<T extends Member>(packs: readonly { items: readonly T[] }[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of packs)
    for (const c of p.items) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
    }
  return out;
}

export type PackState = { total: number; done: number; todo: number; kind: "all" | "more" | "done" };

/** "Add all 8" (none added), "Add 4 more" (some), or "All added" with Remove pack. */
export function packState(items: readonly Member[], watched: ReadonlySet<string>): PackState {
  const done = items.filter((c) => isAdded(watched, c)).length;
  const todo = items.length - done;
  return { total: items.length, done, todo, kind: done === 0 ? "all" : todo > 0 ? "more" : "done" };
}

/** One change the tray can undo: what it added (keys) and what it removed (the entries, to put back). */
export type Change = { text: string; added: string[]; removed: CompanyRow[] };
/**
 * This visit: what you added, by key, with the pack it came from (null: added one by one); the changes
 * Undo walks back; the last one, for the tray. `touched`: something happened, so the tray stays (it
 * never disappears from under the Undo you just pressed).
 */
export type Visit = { added: Map<string, { ref: CompanyRef; pack: string | null }>; hist: Change[]; last: string | null; touched: boolean };

export const emptyVisit = (): Visit => ({ added: new Map(), hist: [], last: null, touched: false });

/** Record an add. `keys` are the ones actually added (already-yours companies aren't part of the change). */
export function recordAdd(v: Visit, refs: readonly CompanyRef[], keys: readonly string[], text: string, packOf: (ref: CompanyRef) => string | null): Visit {
  if (!keys.length) return v;
  const added = new Map(v.added);
  const wanted = new Set(keys);
  for (const ref of refs) {
    const k = keyOf(ref);
    if (wanted.has(k) && !added.has(k)) added.set(k, { ref, pack: packOf(ref) });
  }
  return { added, hist: [...v.hist, { text, added: [...keys], removed: [] }], last: text, touched: true };
}

/** Record a removal: Undo puts the same entries back. */
export function recordRemove(v: Visit, removed: readonly CompanyRow[], text: string): Visit {
  if (!removed.length) return v;
  return { ...v, hist: [...v.hist, { text, added: [], removed: [...removed] }], last: text, touched: true };
}

/** Take the last change off the history: the caller removes `added` and puts `removed` back. */
export function undoLast(v: Visit): { visit: Visit; change: Change } | null {
  const change = v.hist[v.hist.length - 1];
  if (!change) return null;
  const hist = v.hist.slice(0, -1);
  return { visit: { ...v, hist, last: hist[hist.length - 1]?.text ?? null }, change };
}

/**
 * "Next in this pack": after you pick one company in a pack, up to 2 of the pack's extras join its
 * end, the new ones marked for one render (`fresh`). Nothing is fetched and nothing above them moves.
 * By industry: the extras shown so far, in order, and the pick they followed.
 */
export type NextUp = Record<string, { keys: string[]; after: string; fresh: string[] }>;

/** No company marked new any more (any other change in the packs). */
export function clearFresh(state: NextUp): NextUp {
  if (!Object.values(state).some((p) => p.fresh.length)) return state;
  return Object.fromEntries(Object.entries(state).map(([k, p]) => [k, { ...p, fresh: [] }]));
}

/** After picking `after` in this pack: show the next `n` extras you don't have yet. */
export function revealNext<T extends Member>(state: NextUp, pack: { industry: string; more?: readonly T[] }, after: string, watched: ReadonlySet<string>, n = 2): NextUp {
  const next = clearFresh(state);
  const shown = next[pack.industry]?.keys ?? [];
  const add = (pack.more ?? [])
    .filter((c) => !shown.includes(c.key) && !isAdded(watched, c))
    .slice(0, n)
    .map((c) => c.key);
  if (!add.length) return next;
  return { ...next, [pack.industry]: { keys: [...shown, ...add], after, fresh: add } };
}

/** A pack's companies as shown: its own, then the extras revealed so far. */
export function packMembers<T extends Member>(pack: { industry: string; items: readonly T[]; more?: readonly T[] }, state: NextUp): T[] {
  const keys = state[pack.industry]?.keys ?? [];
  const extra = keys.map((k) => (pack.more ?? []).find((c) => c.key === k)).filter((c): c is T => !!c);
  return [...pack.items, ...extra];
}
