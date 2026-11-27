import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "../../lib/data";
import type { RadarList } from "./useRadarList";

const PAGE = 40;

/**
 * The Radar list's paging and selection: which page is shown (grown by a sentinel near the end), which role is
 * current, J/K moves, and focus that follows the current row.
 */
export function useRadarNav(list: Pick<RadarList, "groups" | "rows" | "navGroups" | "listKey">, wide: boolean, overlayOpen: boolean, onOpenOverlay: (job: Job) => void) {
  const { groups, rows, navGroups, listKey } = list;
  // New filters or sort start the list at its first page: the page count is kept for the list it was set on.
  const [paged, setPaged] = useState<{ for: unknown; n: number }>({ for: null, n: PAGE });
  const limit = paged.for === listKey ? paged.n : PAGE;
  const setLimit = useCallback((next: (n: number) => number) => setPaged((s) => ({ for: listKey, n: next(s.for === listKey ? s.n : PAGE) })), [listKey]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedGroup = groups.find((g) => g.jobs.some((j) => j.id === selectedId)) ?? (wide ? navGroups[0] : undefined);
  const selected = selectedGroup?.jobs.find((j) => j.id === selectedId) ?? selectedGroup?.lead;
  const index = selectedGroup ? navGroups.indexOf(selectedGroup) : -1;
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const sentinel = useRef<HTMLLIElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list growing or paging moves the sentinel: re-observe it
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setLimit((l) => l + PAGE), { root: wide ? listRef.current : null, rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [wide, rows.length, limit, setLimit]);

  const select = useCallback(
    (job: Job) => {
      setSelectedId(job.id);
      if (!wide) onOpenOverlay(job);
    },
    [wide, onOpenOverlay],
  );
  /**
   * J/K move focus between rows (design/components/Feed): after the selection changes and the row is
   * rendered with aria-current, focus its title, so focus and the current row never disagree. Not while
   * the phone drawer is open: the list behind it is inert.
   */
  const focusPending = useRef<string | null>(null);
  useEffect(() => {
    const key = focusPending.current;
    if (!key || !selectedGroup || selectedGroup.key !== key) return;
    focusPending.current = null;
    const row = rowRefs.current.get(key);
    if (!(!wide && overlayOpen)) row?.querySelector<HTMLElement>("[data-job-link]")?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  });
  const move = useCallback(
    (d: number) => {
      if (!navGroups.length) return;
      const next = Math.max(0, Math.min(navGroups.length - 1, (index < 0 ? -1 : index) + d));
      const g = navGroups[next]!;
      const row = rows.findIndex((r) => r.kind === "group" && r.group === g);
      if (row >= limit) setLimit(() => row + PAGE);
      setSelectedId(g.lead.id);
      if (!wide && overlayOpen) onOpenOverlay(g.lead);
      // Focus moves once the new row is rendered and marked current (the effect above).
      focusPending.current = g.key;
    },
    [navGroups, rows, index, limit, setLimit, wide, overlayOpen, onOpenOverlay],
  );
  const registerRow = useCallback((key: string, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);
  const openJob = useCallback((j: Job) => setSelectedId(j.id), []);

  return { limit, selectedGroup, selected, index, listRef, sentinel, select, move, registerRow, openJob };
}
