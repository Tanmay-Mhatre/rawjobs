import type { ReactNode } from "react";

/**
 * The notices above the page (NoticeSlot): one shows, the rest wait behind "n more notices".
 *
 * Adding one is a single hook that returns `Notice | null`: give it an id, a priority from PRIORITY
 * and a `render`, then pass the hook's result in App's list (PageNotices). The notice keeps its own
 * markup and its own dismiss storage; the slot only decides what shows.
 */
export type Notice = {
  /** Stable while it's the same notice (it keys the row and the once-a-day record). */
  id: string;
  /** Lower wins (PRIORITY). */
  priority: number;
  tone: "info" | "warn" | "danger";
  /** Newer wins a tie (ms). */
  at?: number;
  /** What shows in the slot; null while only its dialog is left (say, it went away while its dialog is open). */
  render: (() => ReactNode) | null;
  /** A dialog the notice opened: rendered whether or not the notice is in view, so it stays open. */
  dialog?: ReactNode;
};

/** The priority table (6-ux-a11y.md U7). 1-6 are urgent; 9-11 are low and wait for a calmer visit. */
export const PRIORITY = {
  reconnecting: 1,
  pageFailed: 2,
  saveFailed: 3,
  scheduleBroken: 3,
  feedStale: 4,
  updateFailed: 5,
  scheduledMissed: 6,
  telegramFailed: 7,
  failingCompanies: 8,
  reminder: 9,
  checklist: 10,
  telegramPromo: 11,
} as const;

export const isUrgent = (n: Notice) => n.priority <= 6;
export const isLow = (n: Notice) => n.priority >= 9;
/** Read out at once (a nested role=alert): the page can't load or save. */
export const isAlert = (n: Notice) => n.priority >= 2 && n.priority <= 3;

/** localStorage: `${day}|${id}`, the one low notice shown that day. */
export const SHOWN_ON_KEY = "rawjobs.noticeShownOn";

/** The local calendar day, "2026-11-27". */
export const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Which notice shows and which wait behind "n more". Low notices (P9-P11) are held back in a session
 * that had an urgent one (P1-P6), and only one of them a day shows: the one `shownOn` names today,
 * or, if none yet, the first.
 */
export function pickNotices(list: (Notice | null)[], session: { hadUrgent: boolean }, today: string, shownOn: string | null): { shown: Notice | null; more: Notice[] } {
  const active = list.filter((n): n is Notice => !!n?.render);
  const sorted = active
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.priority - b.n.priority || (b.n.at ?? 0) - (a.n.at ?? 0) || a.i - b.i)
    .map(({ n }) => n);
  const calm = !session.hadUrgent && !sorted.some(isUrgent);
  const claimed = shownOn?.startsWith(`${today}|`) ? shownOn.slice(today.length + 1) : null;
  const low = calm ? (claimed ? sorted.find((n) => isLow(n) && n.id === claimed) : sorted.find(isLow)) : undefined;
  const kept = sorted.filter((n) => !isLow(n) || n === low);
  return { shown: kept[0] ?? null, more: kept.slice(1) };
}
