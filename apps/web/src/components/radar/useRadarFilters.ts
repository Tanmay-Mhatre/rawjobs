import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FILTERS, fromQuery, sameFilters, toQuery, type Filters, type Sort } from "../../lib/filters";
import { load, save } from "../../lib/storage";

const FILTER_KEY = "rawjobs.radar.v2";

/**
 * Filters + sort: from the URL (shareable, Back works), else your own changes if you made any,
 * else your profile's filters. Until you change them, they follow your profile (e.g. after Settings).
 * The URL is written against `linkBase` (your profile's places, before "Show everywhere"), so a link
 * leaves out what your profile already says, and what it leaves out comes from your profile.
 */
export function useRadarFilters(base: Filters, linkBase: Filters) {
  const [state, setState] = useState<{ filters: Filters; sort: Sort }>(() => {
    const fromUrl = fromQuery(location.hash.split("?")[1] ?? "", linkBase);
    if (fromUrl) return fromUrl;
    const stored = load<{ filters?: Partial<Filters>; sort?: Sort; custom?: boolean }>(FILTER_KEY, {});
    return { filters: stored.custom ? { ...DEFAULT_FILTERS, ...stored.filters, q: "" } : base, sort: stored.sort ?? "best" };
  });
  const baseRef = useRef(base);
  /** Set after "Save to my profile": the next profile is yours, so the filters follow it. */
  const adopt = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the profile's filters change; reading the current filters mustn't re-run it
  useEffect(() => {
    // Profile changed: follow it, unless you've changed the filters yourself.
    if (adopt.current || sameFilters(state.filters, baseRef.current)) setState((s) => ({ ...s, filters: { ...base, q: s.filters.q } }));
    adopt.current = false;
    baseRef.current = base;
  }, [base]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: linkBase changes only with the filters above
  useEffect(() => {
    save(FILTER_KEY, { filters: { ...state.filters, q: "" }, sort: state.sort, custom: !sameFilters(state.filters, baseRef.current) });
    const q = toQuery(state.filters, state.sort, linkBase);
    const next = `#radar${q ? `?${q}` : ""}`;
    if (location.hash !== next && location.hash.split("?")[0] === "#radar") history.replaceState(null, "", next);
  }, [state]);
  const setFilters = useCallback((patch: Partial<Filters>) => setState((s) => ({ ...s, filters: { ...s.filters, ...patch } })), []);
  const setSort = useCallback((sort: Sort) => setState((s) => ({ ...s, sort })), []);
  const replace = useCallback((filters: Filters, sort: Sort) => setState({ filters, sort }), []);
  const adoptNextProfile = useCallback((on = true) => {
    adopt.current = on;
  }, []);
  return { ...state, setFilters, setSort, replace, adoptNextProfile };
}
