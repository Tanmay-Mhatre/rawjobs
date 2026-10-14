import { groupKey } from "./dashboard";
import { seniorityCue } from "./catalog/seniority";
import { matchesAny } from "./text";

/**
 * Hiring activity: how many new roles each company opens, month by month. The daily job feed build
 * (scripts/catalog/activity.ts) records every directory company's new roles from each day's change
 * file and publishes the totals next to the feed (jobs-activity-<seq>.json.br, listed in the signed
 * jobs-v2-manifest.json). The app shows them in the job drawer ("Hiring at …") and tags a company
 * opening far more roles than usual ("Hiring surge"). It never changes a job's score.
 *
 * A new role is a job id first seen that day whose title (groupKey's title part: place left out,
 * "Sr." is "Senior") the company hasn't listed in the last 60 days: a repost, or the same role posted
 * in more cities, isn't new. Browser-safe: no Node imports.
 */
export const ACTIVITY_SCHEMA = 1;
/** Months kept per company: 12 bars and the month before them, so the usual pace has a year to average. */
export const ACTIVITY_MONTHS = 13;
/** "The last 30 days". */
export const WINDOW_DAYS = 30;
/** A title listed within this many days makes a new id with it a repost (as REPOST_WITHIN_DAYS in diff.ts). */
export const REPOST_DAYS = 60;
/**
 * Days of records needed before a company's usual pace is worth comparing with: 6 weeks, so at least
 * 12 recorded days before the last 30. "Comparisons show after 6 weeks."
 */
export const BASELINE_MIN_DAYS = 42;
/** A hiring surge: at least this many new roles in the last 30 days... */
export const SURGE_MIN_ROLES = 5;
/** ...and at least this many times the usual pace. */
export const SURGE_FACTOR = 2;
/** The drawer says "about 3× their usual pace" only from this ratio up. */
export const PACE_SHOWN_FROM = 1.5;
/** Companies with more open jobs than this can be mass posters (see toActivityFile in scripts/catalog/lib/activity.ts). */
export const MASS_POSTER_OPEN_JOBS = 500;

/** One company's activity in the published file. Arrays are per month, oldest first, `first_month` first. */
export type CompanyActivity = {
  /** New roles per month (13 values); left out when all are 0. */
  m?: number[];
  /** Of them, internships per month; left out when all are 0. */
  i?: number[];
  /** Of them, graduate and early-career roles per month; left out when all are 0. */
  g?: number[];
  /** New roles in the last 30 days. */
  n: number;
  /** Roles (distinct titles) with a posted date in the last 30 days; left out when no open job has a date. */
  p?: number;
  /** The first day this company's new roles were counted, when later than the file's `since`. */
  s?: string;
  /** A mass poster (many open jobs, new ids mostly reusing its titles): never a surge. */
  e?: 1;
};

/** jobs-activity-<seq>.json.br */
export type ActivityFile = {
  schema: number;
  generated_at: string;
  /** The last day recorded (YYYY-MM-DD): "the last 30 days" end here. */
  date: string;
  /** The first day whose new roles were counted; null until the second daily run. */
  since: string | null;
  /** The month of each array's first value (YYYY-MM); the last value is `date`'s month. */
  first_month: string;
  /** By jobCompanyKey() ("greenhouse:acme", "workday:tenant|site"), like the feed. */
  companies: Record<string, CompanyActivity>;
};

export type RoleKind = "internship" | "graduate" | "experienced";

const INTERNSHIP = [
  "intern",
  "interns",
  "internship",
  "internships",
  "co-op",
  "coop",
  "werkstudent",
  "working student",
  "stagiaire",
  "praktikum",
  "praktikant",
  "summer analyst",
  "summer associate",
  "placement student",
  "industrial placement",
  "year in industry",
];
const GRADUATE = ["graduate", "graduates", "grad", "new grad", "early career", "early careers", "campus", "trainee", "apprentice", "apprenticeship", "entry level"];
/** Jobs that hire or look after interns and graduates, not jobs for them: "Campus Recruiter", "Graduate Recruitment Lead". */
const HIRES_THEM = ["recruiter", "recruiting", "recruitment", "talent acquisition", "university relations", "campus relations", "coordinator"];

/**
 * What kind of role a title is, from its words (no AI): an internship, a graduate or early-career
 * role, or anything else. A title with a senior level cue (catalog/seniority.ts: "Senior", "Lead",
 * "Head of") is experienced whatever else it says, and so are the people who recruit for them.
 */
export function roleKind(title: string): RoleKind {
  const level = seniorityCue(title);
  if ((level && level !== "entry" && level !== "mid") || matchesAny(title, HIRES_THEM)) return "experienced";
  if (matchesAny(title, INTERNSHIP)) return "internship";
  if (matchesAny(title, GRADUATE)) return "graduate";
  return "experienced";
}

// ---------- days and months ----------

const DAY_MS = 86_400_000;
/** "2026-10-14" -> days since 1970-01-01. */
export const dayNumber = (day: string): number => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / DAY_MS);
/** Days since 1970-01-01 -> "2026-10-14". */
export const dayString = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** "2026-10-14" -> "2026-10". */
export const monthOf = (day: string): string => day.slice(0, 7);
/** "2026-10" moved by `by` months: ("2026-01", -1) -> "2025-12". */
export function addMonths(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
/** Months from `from` to `to`: ("2025-12", "2026-02") -> 2. */
export function monthsBetween(from: string, to: string): number {
  const n = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return n(to) - n(from);
}
/** The months the arrays cover, oldest first, ending with `date`'s month. */
export const activityMonths = (date: string, count = ACTIVITY_MONTHS): string[] => Array.from({ length: count }, (_, i) => addMonths(monthOf(date), i - count + 1));

// ---------- what the app shows ----------

export type HiringSummary = {
  /** Roles in the last 30 days: new ones once 30 days are recorded, before that those posted (from posted dates). */
  last30?: number;
  basis: "new" | "posted";
  /** The first day counted (records started). */
  since: string;
  /** Enough history to compare with (BASELINE_MIN_DAYS). */
  baselineReady: boolean;
  /** The usual number of new roles per 30 days, from the records before the last 30 days. Only when baselineReady. */
  usual?: number;
  /** last30 / usual; Infinity when they usually open none. Only when baselineReady. */
  pace?: number;
  /** Many more new roles than usual (isSurge). */
  surge: boolean;
  /** The last 12 months, oldest first: new roles, or null for a month before records started. */
  months: { month: string; count: number | null }[];
  /** Where the numbers come from: the shared feed's daily read, or your own scans (viewSummary). */
  source?: "feed" | "local";
};

/** Days recorded from `since` to `date`, both counted (0 before any). */
export const recordedDays = (since: string | null | undefined, date: string): number => (since ? Math.max(0, dayNumber(date) - dayNumber(since) + 1) : 0);

/** Comparisons need BASELINE_MIN_DAYS of records: at least 12 days before the last 30. */
export const baselineReady = (since: string | null | undefined, date: string): boolean => recordedDays(since, date) >= BASELINE_MIN_DAYS;

/**
 * The usual number of new roles per 30 days: every new role recorded before the last 30 days, over
 * the days recorded before them (from `since`, or the first kept month when records go back further),
 * scaled to 30 days. Undefined until the baseline is ready.
 */
export function usualPace(c: Pick<CompanyActivity, "m" | "n">, since: string | null | undefined, date: string, firstMonth: string): number | undefined {
  if (!since || !baselineReady(since, date)) return undefined;
  const from = Math.max(dayNumber(since), dayNumber(`${firstMonth}-01`));
  const days = dayNumber(date) - WINDOW_DAYS - from + 1;
  if (days <= 0) return undefined;
  const before = Math.max(0, (c.m ?? []).reduce((a, b) => a + b, 0) - c.n);
  return (before / days) * WINDOW_DAYS;
}

/**
 * A hiring surge: the baseline is ready, the company isn't a mass poster, and it opened at least
 * SURGE_MIN_ROLES new roles in the last 30 days, at least SURGE_FACTOR times its usual pace.
 */
export const isSurge = (last30: number, usual: number | undefined, opts: { ready: boolean; evergreen?: boolean }): boolean =>
  opts.ready && !opts.evergreen && usual !== undefined && last30 >= SURGE_MIN_ROLES && last30 >= SURGE_FACTOR * usual;

/** One company's numbers for the drawer and the tag. `since` is the file's (the company's own `s` wins). */
export function hiringSummary(c: CompanyActivity, ctx: Pick<ActivityFile, "date" | "since" | "first_month">): HiringSummary {
  const since = c.s ?? ctx.since ?? ctx.date;
  const counted = ctx.since !== null || c.s !== undefined;
  const ready = counted && baselineReady(since, ctx.date);
  const recordsCover30 = counted && recordedDays(since, ctx.date) >= WINDOW_DAYS;
  const usual = ready ? usualPace(c, since, ctx.date, ctx.first_month) : undefined;
  const sinceMonth = monthOf(since);
  const last12 = activityMonths(ctx.date, 12).map((month) => {
    if (!counted || month < sinceMonth) return { month, count: null };
    return { month, count: c.m?.[monthsBetween(ctx.first_month, month)] ?? 0 };
  });
  const last30 = recordsCover30 ? c.n : c.p;
  return {
    ...(last30 !== undefined ? { last30 } : {}),
    basis: recordsCover30 ? "new" : "posted",
    since,
    baselineReady: ready,
    ...(usual !== undefined ? { usual, pace: usual > 0 ? c.n / usual : Infinity } : {}),
    surge: isSurge(c.n, usual, { ready, evergreen: c.e === 1 }),
    months: last12,
  };
}

/** "3×", "2.5×", "1.5×": halves below 3, whole numbers above. */
export function paceLabel(pace: number): string {
  const r = pace < 3 ? Math.round(pace * 2) / 2 : Math.round(pace);
  return `${r}×`;
}

/** The "Hiring surge" tag's hover text: "Acme opened 14 roles in the last 30 days; usually about 5." */
export function surgeTitle(company: string, surge: { n: number; usual: number }): string {
  const usual = Math.round(surge.usual);
  return `${company} opened ${surge.n} ${surge.n === 1 ? "role" : "roles"} in the last 30 days; ${usual ? `usually about ${usual}` : "usually none"}.`;
}

/** The drawer shows the block only with something to say: a count for the last 30 days, or a month with new roles. */
export const hasHiringData = (s: HiringSummary): boolean => s.last30 !== undefined || s.months.some((m) => !!m.count);

// ---------- your own companies: the same numbers from your scans ----------

/** What localActivity reads of a job in your history (core Job has all of it). */
export type LocalJob = { title: string; firstSeen: string; lastSeen: string; postedAt?: string; status: "open" | "closed" };

/**
 * The same numbers for a company the feed doesn't cover (your own companies on other hiring systems),
 * from your scan history: its jobs' first-seen days, in order. Its records start the day it was first
 * scanned (the earliest first-seen), and jobs found then are its starting point, not new roles. Reposts
 * keep the first posting's first-seen day (diff.ts), so they never count again; a new id with a title
 * listed in the last 60 days (one role posted per city) doesn't either. History drops closed jobs 60
 * days after they close, so months further back can miss short-lived roles.
 */
export function localActivity(jobs: readonly LocalJob[], date: string): CompanyActivity | undefined {
  if (!jobs.length) return undefined;
  const d = dayNumber(date);
  const ordered = [...jobs].sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : 0));
  const firstScan = dayNumber(ordered[0]!.firstSeen);
  const months = activityMonths(date);
  const m = months.map(() => 0);
  const i = months.map(() => 0);
  const g = months.map(() => 0);
  let n = 0;
  let reposts = 0;
  /** Title -> the last day a job with it was listed, among jobs found so far. */
  const lastListed = new Map<string, number>();
  for (const j of ordered) {
    const first = dayNumber(j.firstSeen);
    const title = groupKey("", j.title);
    const before = lastListed.get(title);
    lastListed.set(title, Math.max(before ?? 0, dayNumber(j.lastSeen)));
    if (first <= firstScan) continue;
    if (before !== undefined && first - before <= REPOST_DAYS) {
      reposts++;
      continue;
    }
    const at = monthsBetween(months[0]!, monthOf(j.firstSeen));
    if (at < 0) continue;
    m[at]!++;
    const kind = roleKind(j.title);
    if (kind === "internship") i[at]!++;
    else if (kind === "graduate") g[at]!++;
    if (d - first < WINDOW_DAYS) n++;
  }
  const open = jobs.filter((j) => j.status === "open");
  const posted = new Set<string>();
  let dated = false;
  for (const j of open) {
    if (!j.postedAt) continue;
    dated = true;
    const age = d - dayNumber(j.postedAt);
    if (age >= 0 && age < WINDOW_DAYS) posted.add(groupKey("", j.title));
  }
  return {
    ...(m.some(Boolean) ? { m } : {}),
    ...(i.some(Boolean) ? { i } : {}),
    ...(g.some(Boolean) ? { g } : {}),
    n,
    ...(dated ? { p: posted.size } : {}),
    s: dayString(Math.min(firstScan, d)),
    ...(open.length > MASS_POSTER_OPEN_JOBS && (reposts > n || n > open.length / 2) ? { e: 1 as const } : {}),
  };
}

// ---------- data/activity.json: what the dashboard reads ----------

/** A source's day, start and months (the feed's, or your own scans'). */
export type ActivityCtx = Pick<ActivityFile, "date" | "since" | "first_month">;

/**
 * data/activity.json, written with each scan (store.ts): the companies on your Radar, from the shared
 * feed's activity when it covers them, else from your own scans. By the job's companyKey.
 */
export type ActivityView = {
  version: 1;
  /**
   * At least one company has enough records to compare with. Until then the "Hiring surge" tag and
   * filter stay hidden: for the first 6 weeks the filter would only ever be empty.
   */
  ready: boolean;
  feed?: ActivityCtx;
  local?: ActivityCtx;
  companies: Record<string, CompanyActivity & { src: "feed" | "local" }>;
};

/** One company's summary from data/activity.json; undefined when there's nothing for it. */
export function viewSummary(view: ActivityView | null | undefined, companyKey: string | undefined): HiringSummary | undefined {
  const c = companyKey ? view?.companies[companyKey] : undefined;
  const ctx = c && (c.src === "feed" ? view!.feed : view!.local);
  if (!c || !ctx) return undefined;
  const s = hiringSummary(c, ctx);
  return hasHiringData(s) ? { ...s, source: c.src } : undefined;
}
