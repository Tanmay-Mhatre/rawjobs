import type { Job } from "./data";
import { ageDays, postedOrSeen } from "./format";

/** Postings older than this are still shown, but marked as maybe filled. */
export const OLDER_DAYS = 60;
/** Most roles are filled in 45-60 days, senior ones in three months: past four, an opening is rarely still live. */
const VERY_OLD_DAYS = 120;
/** A board date this recent on a job listed for OLDER_DAYS or more: the board refreshes its date. */
const FRESH_BOARD_DAYS = 30;
/** A description shorter than this (in characters) says little about the role: often a placeholder. */
const SHORT_DESCRIPTION = 300;

/** "older" past OLDER_DAYS: worth a word before you spend time on it. */
export const isOlder = (j: Job, now = Date.now()) => ageDays(postedOrSeen(j), now) > OLDER_DAYS;

export type StaleCtx = {
  now?: number;
  /** The description's length when it's loaded (the drawer has it); else job.descriptionLength is used. */
  descriptionLength?: number;
};

type Signal = { text: string; weight: 1 | 2 };

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const month = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short" });
const TIMES = ["", "once", "twice"];

/** "today", "3 days ago", "4 months ago": the age written out, for sentences. */
function ago(days: number): string {
  const d = Math.floor(days);
  if (d < 1) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return m === 1 ? "a month ago" : `${m} months ago`;
  const y = Math.floor(m / 12);
  return y === 1 ? "a year ago" : `${y} years ago`;
}

/**
 * Signs that a job may be stale (a "ghost job": still listed, but likely filled or never really open).
 * Weight 2 is a strong sign, 1 a weak one; see isStale. Only open jobs: a closed one says so already.
 */
function signals(j: Job, ctx: StaleCtx = {}): Signal[] {
  if (j.status !== "open") return [];
  const now = ctx.now ?? Date.now();
  const out: Signal[] = [];
  const listed = ageDays(j.firstSeen, now);
  const board = j.boardPostedAt ? ageDays(j.boardPostedAt, now) : Infinity;
  if (listed >= OLDER_DAYS && board <= FRESH_BOARD_DAYS) {
    // Strong: the board makes an old job look new. Says how old, so no separate "Posted N ago".
    out.push({ text: `Listed since ${dayMonth(j.firstSeen)} (${Math.floor(listed)} days), though the board says posted ${ago(board)}`, weight: 2 });
  } else {
    const age = ageDays(postedOrSeen(j), now);
    if (age > OLDER_DAYS) out.push({ text: `${j.postedAt ? "Posted" : "First seen"} ${ago(age)}`, weight: age > VERY_OLD_DAYS ? 2 : 1 });
  }
  // Older saves have repostedAt without a count: one repost.
  const reposts = j.repostCount ?? (j.repostedAt ? 1 : 0);
  if (reposts > 0 && j.repostedAt) {
    const times = TIMES[reposts] ?? `${reposts} times`;
    out.push({ text: `Taken down and posted again ${times} (${reposts > 1 ? "last in " : ""}${month(j.repostedAt)})`, weight: reposts > 1 ? 2 : 1 });
  }
  const length = j.descriptionLength ?? ctx.descriptionLength;
  if (length && length < SHORT_DESCRIPTION) out.push({ text: `The description is short (${length} characters)`, weight: 1 });
  return out;
}

/** Why a job may be stale, in plain sentences (empty when there's no sign at all). */
export const staleReasons = (j: Job, ctx?: StaleCtx): string[] => signals(j, ctx).map((s) => s.text);

/**
 * Tagged "May be stale": one strong sign or two weak ones (weights add up to 2 or more).
 * Strong: listed 60+ days while the board's date is from the last 30, posted 120+ days ago, or reposted twice or more.
 * Weak: posted 60-120 days ago, reposted once, or a description under 300 characters.
 */
export const isStale = (j: Job, ctx?: StaleCtx): boolean => signals(j, ctx).reduce((sum, s) => sum + s.weight, 0) >= 2;

/**
 * A role posted in several places may be stale only when every posting is: one fresh posting means the
 * role is still live. `ctxOf` gives each posting's context (the drawer has one description's length).
 */
export const isRoleStale = (postings: readonly Job[], ctxOf: (j: Job) => StaleCtx | undefined = () => undefined): boolean => postings.length > 0 && postings.every((j) => isStale(j, ctxOf(j)));
