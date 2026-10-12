import { keyOf, type CompanyRef } from "./companies";
import type { CompanyRow } from "./setup";

/**
 * Starter packs and the tray at the bottom of the Companies page. The pack buttons and progress are
 * worked out from your companies (so a finished pack still offers Remove pack after a reload); the
 * tray remembers this visit only: what you added, grouped by pack, and the changes Undo walks back.
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

/** What you added this visit and still have, grouped by pack in the order you first added from it. */
export function visitGroups(v: Visit, watched: ReadonlySet<string>): { pack: string | null; refs: CompanyRef[] }[] {
  const groups = new Map<string | null, CompanyRef[]>();
  for (const [key, { ref, pack }] of v.added) {
    if (!watched.has(key)) continue;
    groups.set(pack, [...(groups.get(pack) ?? []), ref]);
  }
  return [...groups].map(([pack, refs]) => ({ pack, refs }));
}

export const visitCount = (v: Visit, watched: ReadonlySet<string>) => [...v.added.keys()].filter((k) => watched.has(k)).length;
