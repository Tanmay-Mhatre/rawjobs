import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CompanyIndex, companyIndexAsync } from "./company-search";
import { type BrowseAnswer, type BrowseGroup, type BrowseRequest, type DirCompany, MAX_KEYS, pageOf, searchDirectory } from "./directory-search";

export { type BrowseAnswer, type BrowseRequest, cleanBrowseRequest } from "./directory-search";

/**
 * Companies → Browse all, answered by a long-running `rawjobs directory search --serve` process next to
 * the local server: the directory (250k+ companies) is read and indexed there once, not in the page and
 * not on the server's own thread. Every answer is one page of results.
 */

const stampOf = (file: string) => {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "-";
  }
};

/**
 * The directory as Browse all sees it (data/catalog/directory.json, plus companies added by link since
 * the last publish), read again whenever either file changes (a directory update, a retry).
 */
export function directoryBrowser(dataDir: string) {
  const dirFile = join(dataDir, "catalog", "directory.json");
  const addFile = join(dataDir, "catalog", "additions.json");
  let loaded: { stamp: string; all: DirCompany[]; byKey: Map<string, DirCompany>; index?: CompanyIndex<DirCompany>; building?: Promise<CompanyIndex<DirCompany>> } | null = null;
  /** The last few result lists (any page of them), so paging through one is instant. */
  const results = new Map<string, BrowseGroup[]>();

  function load(): typeof loaded {
    const stamp = `${stampOf(dirFile)}|${stampOf(addFile)}`;
    if (loaded?.stamp === stamp) return loaded;
    results.clear();
    loaded = null;
    let dir: { companies?: DirCompany[] };
    try {
      dir = JSON.parse(readFileSync(dirFile, "utf8"));
    } catch {
      return null;
    }
    if (!Array.isArray(dir.companies)) return null;
    let adds: DirCompany[] = [];
    try {
      const a = JSON.parse(readFileSync(addFile, "utf8")) as { companies?: DirCompany[] };
      adds = Array.isArray(a.companies) ? a.companies : [];
    } catch {
      // No additions yet.
    }
    const known = new Set(dir.companies.map((c) => c.key));
    const extra = adds.filter((c) => !known.has(c.key)).map((c): DirCompany => ({ ...c, tier: "dump", indexed: false, origin: "user" }));
    const all = [...dir.companies, ...extra];
    loaded = { stamp, all, byKey: new Map(all.map((c) => [c.key, c])) };
    return loaded;
  }

  /**
   * Build the search index (about 3 s for 250k companies) a slice at a time, so page and filter
   * changes are still answered meanwhile; a search waits for it.
   */
  function prepareSearch(): Promise<CompanyIndex<DirCompany> | undefined> {
    const d = load();
    if (!d) return Promise.resolve(undefined);
    if (d.index) return Promise.resolve(d.index);
    d.building ??= companyIndexAsync(d.all).then(
      (index) => {
        d.index = index;
        return index;
      },
      (err: Error) => {
        // Try again on the next search.
        d.building = undefined;
        throw err;
      },
    );
    return d.building;
  }

  return {
    /** Read the directory now (the page is open: the first answer comes sooner). False when there's none. */
    warm(): boolean {
      return !!load();
    },
    prepareSearch,
    searchReady: () => !!loaded?.index,
    async search(r: BrowseRequest): Promise<BrowseAnswer> {
      let d = load();
      if (!d) return { missing: true };
      if (r.q.trim() && !d.index) {
        await prepareSearch();
        // The files may have changed while it built: answer from what's there now.
        d = load();
        if (!d) return { missing: true };
        if (!d.index) await prepareSearch();
      }
      const key = JSON.stringify([r.q.trim().toLowerCase(), r.industry, r.system, r.watched, r.fit]);
      let list = results.get(key);
      if (!list) {
        list = searchDirectory(d.all, { q: r.q, watched: new Set(r.watched), fit: new Map(Object.entries(r.fit)), system: r.system, industry: r.industry || undefined, index: d.index });
        results.set(key, list);
        for (const k of [...results.keys()].slice(0, -4)) results.delete(k);
      }
      return pageOf(list, r, !!d.index);
    },
    /** Names for directory keys (the Hidden list shows muted companies by name). */
    names(keys: readonly string[]): Record<string, string> {
      const d = load();
      const out: Record<string, string> = {};
      if (d) for (const k of keys.slice(0, MAX_KEYS)) if (typeof k === "string" && d.byKey.has(k)) out[k] = d.byKey.get(k)!.name;
      return out;
    },
  };
}
