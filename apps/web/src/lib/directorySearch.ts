import { type CompanyIndex, companyIndexAsync } from "@rawjobs/core/company-search";
import { type BrowseAnswer, type BrowseRequest, countCompanies, type DirCompany, pageOf, searchDirectory } from "@rawjobs/core/directory-search";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ApiRoutes } from "@rawjobs/core/protocol";
import { getJson } from "./api";
import { canRunLocally } from "./data";
import { ACTION_TIMEOUT_MS } from "./net";

/**
 * Companies → Browse all, a page at a time. The installed app asks its server (POST /api/directory/search),
 * which keeps the 250k-company directory in a search process of its own: the page never downloads it.
 * A hosted copy (no server) reads catalog/directory.json once and searches it here, with the same code.
 */

export type { BrowseAnswer };
export type DirectoryQuery = Pick<BrowseRequest, "q" | "industry" | "system" | "page"> & { pageSize?: number; hideWatched?: boolean };

/** How long a request may run before the page shows placeholders instead of the last answer. */
export const SLOW_MS = 300;
/** How long typing must pause before a search is sent. */
const TYPING_MS = 150;

// ---------- the hosted copy: the directory read once, here ----------

let hosted: { rev: number; load: Promise<DirCompany[] | null>; index?: Promise<CompanyIndex<DirCompany>> } | null = null;

function hostedDirectory(rev: number): Promise<DirCompany[] | null> {
  if (hosted?.rev === rev) return hosted.load;
  // catalog/*.json, files the hosted copy serves: { companies }.
  const get = (path: string) =>
    fetch(path, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return null;
      const file: { companies: DirCompany[] } = await r.json();
      return file;
    });
  const load = Promise.all([get("./catalog/directory.json"), get("./catalog/additions.json").catch(() => null)]).then(([dir, adds]) => {
    if (!dir) return null;
    const known = new Set(dir.companies.map((c) => c.key));
    const extra = (adds?.companies ?? []).filter((c) => !known.has(c.key)).map((c): DirCompany => ({ ...c, tier: "dump", indexed: false, origin: "user" }));
    return [...dir.companies, ...extra];
  });
  // A failed read is tried again next time.
  load.catch(() => (hosted = null));
  hosted = { rev, load };
  return load;
}

async function hostedSearch(r: BrowseRequest, rev: number): Promise<BrowseAnswer> {
  const all = await hostedDirectory(rev);
  if (!all) return { missing: true };
  const h = hosted!;
  // Built a slice at a time, so the page keeps responding while it builds.
  const index = r.q.trim() ? await (h.index ??= companyIndexAsync(all)) : undefined;
  const watched = new Set(r.watched);
  let list = searchDirectory(all, { q: r.q, watched, fit: new Map(Object.entries(r.fit)), system: r.system, industry: r.industry || undefined, index });
  if (r.hideWatched) list = list.filter((g) => !watched.has(g.lead.key) && !g.others.some((c) => watched.has(c.key)));
  return pageOf(list, r, true);
}

// ---------- asking ----------

async function post<R extends `POST /api/directory/${"search" | "names" | "warm"}`>(route: R, body: unknown, signal?: AbortSignal): Promise<ApiRoutes[R]> {
  const r = await getJson(route, { headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, timeoutMs: ACTION_TIMEOUT_MS * 2 });
  if (!r.ok) throw new Error(r.status ? `The directory search answered ${r.status}.` : r.error);
  return r.data;
}

/** One page of Browse all (or { missing: true } when the directory isn't downloaded). */
export function searchCompanies(r: BrowseRequest, opts: { rev?: number; signal?: AbortSignal } = {}): Promise<BrowseAnswer> {
  return canRunLocally ? post("POST /api/directory/search", r, opts.signal) : hostedSearch(r, opts.rev ?? 0);
}

/** Read the directory ahead of Browse all (the installed app's search process); nothing on a hosted copy. */
export function warmDirectory(): void {
  if (canRunLocally) post("POST /api/directory/warm", {}).catch(() => {});
}

type SearchState = { answer: BrowseAnswer | null; error: string | null; loading: boolean; slow: boolean };

/**
 * Browse all's results for a query, kept while the next one loads: `slow` turns on when a request has
 * run SLOW_MS (show placeholders then, not for a quick page change). Typing waits TYPING_MS before
 * asking, and an older answer never replaces a newer one. Your companies (`watched`) go with each
 * request but don't trigger one: adding a company doesn't reshuffle the list under you.
 */
export function useDirectorySearch(query: DirectoryQuery, opts: { watched: ReadonlySet<string>; fit?: ReadonlyMap<string, number>; rev?: number; enabled?: boolean }): SearchState {
  const { enabled = true, rev = 0 } = opts;
  const watched = useRef(opts.watched);
  // Kept after each render (not during it), for handlers and effects that run later.
  useLayoutEffect(() => {
    watched.current = opts.watched;
  });
  const fit = useMemo(() => Object.fromEntries(opts.fit ?? []), [opts.fit]);
  const [state, setState] = useState<SearchState>({ answer: null, error: null, loading: enabled, slow: false });
  const lastQ = useRef<string | null>(null);
  const key = JSON.stringify([query.q.trim(), query.industry, query.system, query.page, query.pageSize ?? 25, !!query.hideWatched, fit, rev]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the query, fit and rev
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const typing = lastQ.current !== null && lastQ.current !== query.q.trim();
    lastQ.current = query.q.trim();
    setState((s) => ({ ...s, loading: true, error: null }));
    const slow = setTimeout(() => setState((s) => (s.loading ? { ...s, slow: true } : s)), SLOW_MS);
    const ask = setTimeout(
      () => {
        const r: BrowseRequest = {
          q: query.q,
          industry: query.industry,
          system: query.system,
          page: query.page,
          pageSize: query.pageSize ?? 25,
          watched: [...watched.current],
          fit,
          hideWatched: !!query.hideWatched,
        };
        searchCompanies(r, { rev, signal: ctrl.signal })
          .then((answer) => !ctrl.signal.aborted && setState({ answer, error: null, loading: false, slow: false }))
          .catch((err: Error) => !ctrl.signal.aborted && setState((s) => ({ ...s, error: err.message, loading: false, slow: false })));
      },
      typing ? TYPING_MS : 0,
    );
    return () => {
      ctrl.abort();
      clearTimeout(ask);
      clearTimeout(slow);
    };
  }, [key, enabled]);
  return state;
}

/** Names for directory keys (the Hidden list's muted companies); empty until they arrive. */
export function useDirectoryNames(keys: readonly string[], rev = 0): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const key = JSON.stringify([...keys].sort());
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the keys
  useEffect(() => {
    if (!keys.length) return;
    let live = true;
    const ask = canRunLocally
      ? post("POST /api/directory/names", { keys }).then((r) => new Map(Object.entries(r.names ?? {})))
      : hostedDirectory(rev).then((all) => {
          const wanted = new Set(keys);
          return new Map((all ?? []).filter((c) => wanted.has(c.key)).map((c) => [c.key, c.name] as const));
        });
    ask.then((m) => live && setNames(m)).catch(() => {});
    return () => {
      live = false;
    };
  }, [key, rev]);
  return names;
}

/** A hosted copy's company count (countCompanies); the installed app's comes from GET /api/directory. */
export function useHostedCompanyCount(rev = 0): number | undefined {
  const [n, setN] = useState<number>();
  useEffect(() => {
    if (canRunLocally) return;
    let live = true;
    hostedDirectory(rev)
      .then((all) => live && all && setN(countCompanies(all)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rev]);
  return n;
}
