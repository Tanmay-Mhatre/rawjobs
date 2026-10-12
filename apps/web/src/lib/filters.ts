import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { citiesIn, placeOwner } from "@rawjobs/core/catalog/places";
import { SENIORITY_LEVELS, type Seniority } from "@rawjobs/core/catalog/seniority";
import { groupKey } from "@rawjobs/core/dashboard";
import { rankScore } from "@rawjobs/core/score";
import { ATS_LABEL } from "./companies";
import type { Job, Profile } from "./data";
import { ageDays, postedOrSeen } from "./format";
import { hiddenByRules, type HideRule } from "./notForMe";
import type { Status, UserState } from "./userState";

export type Workplace = Job["workplace"];
export type Sort = "best" | "newest" | "salary" | "company";
/** Which tracked jobs to show: everything, or one tracking state. */
export type StatusView = "" | "new" | "saved" | "applied";

export type Filters = {
  q: string;
  /** Posted (or first seen) within this many days; 0 = any time. */
  posted: 0 | 1 | 3 | 7 | 14 | 30 | 90;
  /** Country display names; "Remote" means remote jobs. */
  countries: string[];
  /** Cities, as "City, Country". */
  locations: string[];
  workplace: Workplace[];
  seniority: Seniority[];
  industries: string[];
  companies: string[];
  topics: string[];
  ats: string[];
  match: "all" | "good" | "strong";
  salaryOnly: boolean;
  /** Leave out talent pools, open applications and reposts (evergreenReason). */
  hideEvergreen: boolean;
  status: StatusView;
  showFailed: boolean;
  showClosed: boolean;
  showHidden: boolean;
  /** Only jobs at your companies ("My companies"). */
  mine: boolean;
  /** Include directory jobs posted more than INDEX_MAX_AGE_DAYS ago (often filled already). */
  olderIndex: boolean;
  /** Include postings older than your age limit (ctx.maxAgeDays; hidden by default: usually filled). */
  showOld: boolean;
};

/** Directory jobs older than this are hidden unless asked for: the index is a week old at most, and old postings are often filled. */
export const INDEX_MAX_AGE_DAYS = 30;
/**
 * Postings older than this are hidden unless asked for (Settings › Job list can change it). Most roles are
 * filled in 45-60 days; senior ones can take three months, so three months keeps those and drops the stale tail.
 */
export const DEFAULT_MAX_AGE_DAYS = 90;
/** Postings older than this are still shown, but marked as maybe filled. */
export const OLDER_DAYS = 60;
/** Titles of postings that collect applications rather than fill a role. */
const EVERGREEN_TITLE =
  /talent (pool|community|network|pipeline)|general application|open application|spontaneous application|expression of interest|speculative application|(for )?future (opportunit|openings?|roles?)|always hiring|interest form/i;

/**
 * Why a job may not be a live opening, if it may not: a talent pool or open application ("Join our
 * Talent Community"), or the same role taken down and posted again. Shown on the job, ranked lower in
 * Best match, and can be hidden (More › No talent pools or reposts).
 */
export function evergreenReason(j: Pick<Job, "title" | "repostedAt">): "pool" | "reposted" | undefined {
  if (EVERGREEN_TITLE.test(j.title)) return "pool";
  if (j.repostedAt) return "reposted";
  return undefined;
}
/** Best match: what each kind costs. A talent pool is rarely what you're looking for; a repost may well be. */
const EVERGREEN_RANK = { pool: 15, reposted: 5 } as const;
const evergreenCost = (j: Job) => {
  const r = evergreenReason(j);
  return r ? EVERGREEN_RANK[r] : 0;
};

/** "older" past OLDER_DAYS: worth a word before you spend time on it. */
export const isOlder = (j: Job, now = Date.now()) => ageDays(postedOrSeen(j), now) > OLDER_DAYS;

export const DEFAULT_FILTERS: Filters = {
  q: "",
  posted: 0,
  countries: [],
  locations: [],
  workplace: [],
  seniority: [],
  industries: [],
  companies: [],
  topics: [],
  ats: [],
  match: "all",
  salaryOnly: false,
  hideEvergreen: false,
  status: "",
  showFailed: false,
  showClosed: false,
  showHidden: false,
  mine: false,
  olderIndex: false,
  showOld: false,
};

/** Facets with option counts. */
export type FacetKey = "posted" | "countries" | "locations" | "workplace" | "seniority" | "industries" | "companies" | "topics" | "ats" | "match";

export type Ctx = {
  user: UserState;
  /** Strong-match score (the profile's min_score). */
  min: number;
  /** Industry ids per company name. */
  industriesOf: (company: string) => string[];
  hiddenCompanies: ReadonlySet<string>;
  /** Your Not interested rules (Prefs.hideRules): hidden like a hidden company, never a job you're tracking. */
  hideRules?: readonly HideRule[];
  /** Is this job at one of your companies? (A nudge up in Best match, and the My companies view.) */
  isYours?: (j: Job) => boolean;
  /** The user's own countries, cities and industries (from their profile): listed first in the menus. */
  mine?: { countries: ReadonlySet<string>; locations: ReadonlySet<string>; industries: ReadonlySet<string> };
  /** Only one scan so far: everything is "new", so nothing is tagged New. */
  firstScan?: boolean;
  /** Hide postings older than this many days (0: never). Default DEFAULT_MAX_AGE_DAYS. */
  maxAgeDays?: number;
  /** When the previous scan finished (ms): jobs first found after it are "new to you". */
  newSince?: number;
  now?: number;
};

export const REMOTE = "Remote";
const APPLIED_STAGES: Status[] = ["applied", "interviewing", "offer", "rejected"];

/** Without a previous scan's time, "new" falls back to: first found in the last this-many hours. */
export const NEW_TAG_HOURS = 48;
/** A posting older than this is never "new", even when a scan only just found it. */
export const NEW_MAX_POSTED_DAYS = 30;
/**
 * New to you since your last scan: an open job first found after the previous scan (ctx.newSince), posted within the
 * last month. Directory jobs never are (nobody has scanned them yet), and nothing is on your first scan (everything would be).
 */
export const isNewJob = (j: Job, ctx: Pick<Ctx, "now" | "firstScan" | "newSince">) => {
  const now = ctx.now ?? Date.now();
  const since = ctx.newSince ?? now - NEW_TAG_HOURS * 3_600_000;
  return !ctx.firstScan && !j.estimated && j.status === "open" && Date.parse(j.firstSeen) > since && ageDays(postedOrSeen(j), now) <= NEW_MAX_POSTED_DAYS;
};
/** Shows the "New" tag: the same rule as the New view, so its count matches the tags. */
export const hasNewTag = isNewJob;
/** Remote jobs, and jobs that matched one of your remote regions ("EMEA"), count as "Remote". */
const isRemoteLike = (j: Job) => j.workplace === "remote" || j.why.location === 15 || /\bremote\b/i.test(j.location);
const countriesOf = (j: Job) => (isRemoteLike(j) ? [...j.countries, REMOTE] : j.countries);

/** Does the job pass every filter, except the one named by `skip` (for that facet's counts)? */
function passes(j: Job, f: Filters, ctx: Ctx, terms: string[], skip?: FacetKey): boolean {
  const entry = ctx.user[j.id];
  if (!f.showFailed && j.why.gate) return false;
  if (!f.showHidden && (entry?.status === "dismissed" || ctx.hiddenCompanies.has(j.company))) return false;
  // A rule never hides a job you saved or applied to: you picked that one yourself.
  if (!f.showHidden && !entry?.status && hiddenByRules(j, ctx.hideRules)) return false;
  if (f.mine && !ctx.isYours?.(j)) return false;
  // Age never hides a job you saved or applied to, and the Saved and Applied views keep closed ones too:
  // you need to find those again however old they get.
  const yours = entry?.status === "saved" || (!!entry?.status && APPLIED_STAGES.includes(entry.status));
  if (!f.showClosed && j.status === "closed" && !(yours && (f.status === "saved" || f.status === "applied"))) return false;
  if (!yours && !f.olderIndex && j.estimated && ageDays(postedOrSeen(j), ctx.now) > INDEX_MAX_AGE_DAYS) return false;
  if (!yours && !f.showOld && tooOld(j, ctx)) return false;
  if (f.status === "new" && !isNewJob(j, ctx)) return false;
  if (f.status === "saved" && entry?.status !== "saved") return false;
  if (f.status === "applied" && !(entry?.status && APPLIED_STAGES.includes(entry.status))) return false;
  if (f.salaryOnly && !j.salary) return false;
  if (f.hideEvergreen && evergreenReason(j)) return false;
  if (skip !== "match" && f.match !== "all" && j.score < (f.match === "strong" ? ctx.min : Math.max(0, ctx.min - 20))) return false;
  if (skip !== "posted" && f.posted && ageDays(postedOrSeen(j), ctx.now) > f.posted) return false;
  if (skip !== "countries" && f.countries.length && !countriesOf(j).some((c) => f.countries.includes(c))) return false;
  if (skip !== "locations" && f.locations.length && !j.cities.some((c) => f.locations.includes(c))) return false;
  if (skip !== "workplace" && f.workplace.length && !f.workplace.includes(j.workplace)) return false;
  if (skip !== "seniority" && f.seniority.length && !f.seniority.includes(j.seniority)) return false;
  if (skip !== "industries" && f.industries.length && !ctx.industriesOf(j.company).some((i) => f.industries.includes(i))) return false;
  if (skip !== "companies" && f.companies.length && !f.companies.includes(j.company)) return false;
  if (skip !== "topics" && f.topics.length && !f.topics.some((t) => j.why.keywords.includes(t))) return false;
  if (skip !== "ats" && f.ats.length && !f.ats.includes(j.ats)) return false;
  if (terms.length) {
    const hay = `${j.title} ${j.company} ${j.location} ${j.department ?? ""} ${j.why.keywords.join(" ")}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}

const maxAge = (ctx: Pick<Ctx, "maxAgeDays">) => ctx.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
/** Past your age limit (Settings › Job list). */
const tooOld = (j: Job, ctx: Pick<Ctx, "now" | "maxAgeDays">) => maxAge(ctx) > 0 && ageDays(postedOrSeen(j), ctx.now) > maxAge(ctx);

const termsOf = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

export function applyFilters(jobs: Job[], f: Filters, ctx: Ctx): Job[] {
  const terms = termsOf(f.q);
  return jobs.filter((j) => passes(j, f, ctx, terms));
}

export type FacetOption = {
  value: string;
  label: string;
  count: number;
  /** "yours": from your profile; "other": only mentioned by jobs (shown under its own heading). */
  group?: "yours" | "other";
};

const POSTED_OPTIONS: { value: Filters["posted"]; label: string }[] = [
  { value: 1, label: "Past 24 hours" },
  { value: 3, label: "Past 3 days" },
  { value: 7, label: "Past week" },
  { value: 14, label: "Past 2 weeks" },
  { value: 30, label: "Past month" },
  { value: 90, label: "Past 3 months" },
];
const WORKPLACE_LABEL: Record<Workplace, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Not stated" };
const SENIORITY_LABEL = Object.fromEntries(SENIORITY_LEVELS.map((s) => [s.id, s.label])) as Record<Seniority, string>;

/**
 * Options and counts for every facet. Each facet's counts apply all the *other* active filters,
 * so you can see what picking an option would give (the usual faceted-search rule).
 */
export function facetCounts(jobs: Job[], f: Filters, ctx: Ctx): Record<FacetKey, FacetOption[]> {
  const terms = termsOf(f.q);
  // Counts are roles, like the list: one role posted in three cities counts once (per option it's in).
  const tally = (key: FacetKey, valuesOf: (j: Job) => readonly string[]) => {
    const roles = new Map<string, Set<string>>();
    for (const j of jobs) {
      if (!passes(j, f, ctx, terms, key)) continue;
      for (const v of valuesOf(j)) {
        let set = roles.get(v);
        if (!set) roles.set(v, (set = new Set()));
        set.add(roleOf(j));
      }
    }
    return new Map([...roles].map(([v, set]) => [v, set.size]));
  };
  const sorted = (counts: Map<string, number>, label: (v: string) => string = (v) => v, selected: string[] = [], mine?: ReadonlySet<string>) => {
    // Selected options stay listed even at 0, so they can be unticked; your own ones too.
    for (const s of [...selected, ...(mine ?? [])]) if (!counts.has(s)) counts.set(s, 0);
    return [...counts]
      .map(([value, count]): FacetOption => ({ value, label: label(value), count, ...(mine ? { group: mine.has(value) ? "yours" : "other" } : {}) }))
      .sort((a, b) => Number(b.group === "yours") - Number(a.group === "yours") || b.count - a.count || a.label.localeCompare(b.label));
  };

  const postedPool = jobs.filter((j) => passes(j, f, ctx, terms, "posted"));
  const matchPool = jobs.filter((j) => passes(j, f, ctx, terms, "match"));
  return {
    posted: POSTED_OPTIONS.map((o) => ({ value: String(o.value), label: o.label, count: roleCount(postedPool.filter((j) => ageDays(postedOrSeen(j), ctx.now) <= o.value)) })),
    countries: sorted(tally("countries", countriesOf), (v) => (v === REMOTE ? "Remote & your regions" : v), f.countries, ctx.mine?.countries),
    // "Dubai, United Arab Emirates" reads as "Dubai · United Arab Emirates" in the menu.
    locations: sorted(
      tally("locations", (j) => j.cities),
      (v) => v.replace(/, ([^,]+)$/, " · $1"),
      f.locations,
      ctx.mine?.locations,
    ),
    workplace: (["remote", "hybrid", "onsite", "unknown"] as Workplace[]).map((w) => ({ value: w, label: WORKPLACE_LABEL[w], count: tally("workplace", (j) => [j.workplace]).get(w) ?? 0 })),
    seniority: SENIORITY_LEVELS.map((s) => ({ value: s.id, label: s.label, count: tally("seniority", (j) => [j.seniority]).get(s.id) ?? 0 })),
    industries: sorted(
      tally("industries", (j) => ctx.industriesOf(j.company)),
      (id) => INDUSTRY_BY_ID.get(id)?.label ?? id,
      f.industries,
      ctx.mine?.industries,
    ),
    companies: sorted(
      tally("companies", (j) => [j.company]),
      undefined,
      f.companies,
    ),
    topics: sorted(
      tally("topics", (j) => j.why.keywords),
      undefined,
      f.topics,
    ),
    ats: sorted(
      tally("ats", (j) => [j.ats]),
      atsLabel,
      f.ats,
    ),
    match: [
      { value: "strong", label: `Strong (${ctx.min}+)`, count: roleCount(matchPool.filter((j) => j.score >= ctx.min)) },
      { value: "good", label: `Good (${Math.max(0, ctx.min - 20)}+)`, count: roleCount(matchPool.filter((j) => j.score >= Math.max(0, ctx.min - 20))) },
    ],
  };
}

/** "greenhouse" -> "Greenhouse". */
export const atsLabel = (ats: string) => ATS_LABEL[ats] ?? ats.charAt(0).toUpperCase() + ats.slice(1);

const salaryOf = (j: Job) => j.salary?.max ?? j.salary?.min ?? -1;

/**
 * Sort the list. Every sort means what it says: your companies are never pinned on top. In "best",
 * `isYours` gives them a nudge (rankScore), and freshness counts, worked out at `now`.
 */
export function sortJobs(jobs: Job[], sort: Sort, isYours?: (j: Job) => boolean, now = Date.now()): Job[] {
  const rank = sort === "best" ? new Map(jobs.map((j) => [j, rankScore(j.score, postedOrSeen(j), now, !!isYours?.(j)) - evergreenCost(j)])) : undefined;
  const by: Record<Sort, (a: Job, b: Job) => number> = {
    // Equal ranks go to the one mentioning more of your topics, then the newer.
    best: (a, b) => rank!.get(b)! - rank!.get(a)! || b.why.keywords.length - a.why.keywords.length || postedOrSeen(b).localeCompare(postedOrSeen(a)),
    newest: (a, b) => postedOrSeen(b).localeCompare(postedOrSeen(a)) || b.score - a.score,
    // Only compares like with like loosely: listed salaries first, highest first.
    salary: (a, b) => salaryOf(b) - salaryOf(a) || b.score - a.score,
    company: (a, b) => a.company.localeCompare(b.company) || b.score - a.score,
  };
  return [...jobs].sort(by[sort]);
}

/** The role a posting belongs to: the same key the list groups by (groupJobs). */
const roleOf = (j: Pick<Job, "company" | "title">) => groupKey(j.company, j.title);
/** How many roles these postings make up: what the list shows as rows, and what every count should say. */
export const roleCount = (jobs: readonly Pick<Job, "company" | "title">[]) => new Set(jobs.map(roleOf)).size;

/** One role posted in several places: the best posting leads, the others ride along. */
export type JobGroup = { key: string; lead: Job; jobs: Job[] };

/** Groups by role with the place left out of the title (groupKey), so older saved data groups the same way. */
export function groupJobs(sorted: Job[]): JobGroup[] {
  const groups = new Map<string, JobGroup>();
  for (const j of sorted) {
    const key = roleOf(j);
    const g = groups.get(key);
    if (g) g.jobs.push(j);
    else groups.set(key, { key, lead: j, jobs: [j] });
  }
  return [...groups.values()];
}

/** Roles shown per company before the rest fold into one "+N more at …" row. */
export const PER_COMPANY = 2;

/** A row of the feed: a role, or a company's folded roles. */
export type FeedRow = { kind: "group"; group: JobGroup } | { kind: "more"; company: string; groups: JobGroup[] };

/**
 * One company can't fill the page: after its first PER_COMPANY roles, the rest fold into one row
 * where the next one would have been ("+253 more at Speechify"), until you open it (`open`).
 */
export function foldCompanies(groups: JobGroup[], open: ReadonlySet<string> = new Set()): FeedRow[] {
  const seen = new Map<string, number>();
  const folded = new Map<string, JobGroup[]>();
  const rows: FeedRow[] = [];
  for (const group of groups) {
    const company = group.lead.company;
    const n = (seen.get(company) ?? 0) + 1;
    seen.set(company, n);
    if (n <= PER_COMPANY || open.has(company)) rows.push({ kind: "group", group });
    else {
      let rest = folded.get(company);
      if (!rest) {
        rest = [];
        folded.set(company, rest);
        rows.push({ kind: "more", company, groups: rest });
      }
      rest.push(group);
    }
  }
  return rows;
}

/**
 * The active filters as removable chips. With `base` (your profile's filters), only what differs
 * from it is listed: your own places and industries are shown in the profile bar instead.
 */
export function activeChips(f: Filters, ctx: Pick<Ctx, "min">, base?: Filters): { key: string; label: string; remove: Partial<Filters> }[] {
  const all = chipsOf(f, ctx);
  if (!base) return all;
  const inBase = new Set(chipsOf(base, ctx).map((c) => c.key));
  return all.filter((c) => !inBase.has(c.key));
}

function chipsOf(f: Filters, ctx: Pick<Ctx, "min">): { key: string; label: string; remove: Partial<Filters> }[] {
  const chips: { key: string; label: string; remove: Partial<Filters> }[] = [];
  const list = <K extends "countries" | "locations" | "workplace" | "seniority" | "industries" | "companies" | "topics" | "ats">(k: K, label: (v: string) => string) => {
    for (const v of f[k] as string[]) chips.push({ key: `${k}:${v}`, label: label(v), remove: { [k]: (f[k] as string[]).filter((x) => x !== v) } as Partial<Filters> });
  };
  if (f.q.trim()) chips.push({ key: "q", label: `“${f.q.trim()}”`, remove: { q: "" } });
  if (f.status) chips.push({ key: "status", label: { new: "New to you", saved: "Saved", applied: "Applied" }[f.status], remove: { status: "" } });
  if (f.posted) chips.push({ key: "posted", label: POSTED_OPTIONS.find((o) => o.value === f.posted)!.label, remove: { posted: 0 } });
  list("countries", (v) => (v === REMOTE ? "Remote & your regions" : v));
  list("locations", (v) => v.replace(/, [^,]+$/, ""));
  list("workplace", (v) => WORKPLACE_LABEL[v as Workplace] ?? v);
  list("seniority", (v) => SENIORITY_LABEL[v as Seniority] ?? v);
  list("industries", (v) => INDUSTRY_BY_ID.get(v)?.label ?? v);
  list("companies", (v) => v);
  list("topics", (v) => `Topic: ${v}`);
  list("ats", (v) => `Hiring system: ${atsLabel(v)}`);
  if (f.match !== "all") chips.push({ key: "match", label: f.match === "strong" ? `Strong matches (${ctx.min}+)` : `Good matches (${Math.max(0, ctx.min - 20)}+)`, remove: { match: "all" } });
  if (f.salaryOnly) chips.push({ key: "salary", label: "Salary listed", remove: { salaryOnly: false } });
  if (f.hideEvergreen) chips.push({ key: "evergreen", label: "No talent pools or reposts", remove: { hideEvergreen: false } });
  if (f.showFailed) chips.push({ key: "failed", label: "Including jobs that failed your filters", remove: { showFailed: false } });
  if (f.showClosed) chips.push({ key: "closed", label: "Including closed", remove: { showClosed: false } });
  if (f.showHidden) chips.push({ key: "hidden", label: "Including hidden", remove: { showHidden: false } });
  if (f.mine) chips.push({ key: "mine", label: "My companies", remove: { mine: false } });
  if (f.olderIndex) chips.push({ key: "olderIndex", label: `Including unscanned jobs older than ${INDEX_MAX_AGE_DAYS} days`, remove: { olderIndex: false } });
  if (f.showOld) chips.push({ key: "old", label: "Including older jobs", remove: { showOld: false } });
  return chips;
}

const pretty = (name: string) => name.replace(/(^|\s)\p{L}/gu, (ch) => ch.toUpperCase());

/** Your profile's places as the menus name them: countries ("United Kingdom") and cities ("Dubai, United Arab Emirates"). */
export function profilePlaces(profile: Profile): { countries: string[]; locations: string[]; remote: boolean } {
  const countries = new Set<string>();
  const locations = new Set<string>();
  for (const term of profile.locations.include) {
    const owner = placeOwner(term);
    if (owner?.startsWith("country:")) countries.add(pretty(owner.slice(8)));
    for (const city of citiesIn(term)) if (city.includes(",")) locations.add(city);
  }
  return { countries: [...countries], locations: [...locations], remote: profile.locations.remote_ok.length > 0 };
}

/**
 * The Radar's starting filters, from your profile: your countries (plus remote, if you take remote
 * roles). Jobs already had to pass your profile to get here; this makes it visible. Industries are not
 * a starting filter: we only know them for some companies, so it would hide most of the directory's jobs.
 */
export function profileFilters(profile: Profile): Filters {
  const places = profilePlaces(profile);
  return {
    ...DEFAULT_FILTERS,
    countries: places.countries.length || places.remote ? [...places.countries, ...(places.remote ? [REMOTE] : [])] : [],
  };
}

/** When nothing matches: which single filter, removed, brings back the most jobs. */
export function suggestRelax(jobs: Job[], f: Filters, ctx: Ctx, limit = 3): { label: string; remove: Partial<Filters>; count: number }[] {
  return chipsOf(f, ctx)
    .filter((c) => !["failed", "closed", "hidden", "old"].includes(c.key))
    .map((c) => ({ label: c.label, remove: c.remove, count: roleCount(applyFilters(jobs, { ...f, ...c.remove }, ctx)) }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export const sameFilters = (a: Filters, b: Filters) => JSON.stringify({ ...a, q: "" }) === JSON.stringify({ ...b, q: "" });

/**
 * Filters + sort <-> URL hash query ("#radar?posted=7&countries=United+Arab+Emirates&sort=newest"), written
 * relative to `base` (your profile's filters): a link says only what differs from your profile, and
 * whatever it leaves out comes from your profile when it's opened. So "#radar?q=kraken" searches within
 * your places, and "everywhere" is said out loud ("countries=", empty).
 */
export function toQuery(f: Filters, sort: Sort, base: Filters = DEFAULT_FILTERS): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f) as [keyof Filters, Filters[keyof Filters]][]) {
    const d = base[k];
    if (JSON.stringify(v) === JSON.stringify(d)) continue;
    p.set(k, Array.isArray(v) ? v.join("|") : String(v));
  }
  if (sort !== "best") p.set("sort", sort);
  return p.toString();
}

export function fromQuery(query: string, base: Filters = DEFAULT_FILTERS): { filters: Filters; sort: Sort } | null {
  if (!query) return null;
  const p = new URLSearchParams(query);
  const f: Filters = { ...base };
  const rec = f as unknown as Record<string, unknown>;
  for (const [k, raw] of p) {
    if (k === "sort" || !(k in DEFAULT_FILTERS)) continue;
    const d = DEFAULT_FILTERS[k as keyof Filters];
    rec[k] = Array.isArray(d) ? raw.split("|").filter(Boolean) : typeof d === "number" ? Number(raw) || 0 : typeof d === "boolean" ? raw === "true" : raw;
  }
  const sort = (p.get("sort") ?? "best") as Sort;
  return { filters: f, sort: ["best", "newest", "salary", "company"].includes(sort) ? sort : "best" };
}
