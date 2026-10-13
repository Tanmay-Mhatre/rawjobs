import { companyIndustries, INDUSTRY_BY_ID } from "./catalog/industries";
import { COUNTRIES, countriesIn, countryTerms, groupPlaces } from "./catalog/places";
import { connectors } from "./connectors";
import type { Profile } from "./schema";
import { passesLocationGate, passesTitleGate, scoreJob } from "./score";
import { isPlaceholderBoard, matchesAny, matchesTerm, termRegex } from "./text";

/** [title, location, workplace, ageDays, count] — one merged row per (title, location). ageDays is as of the company's fetched_at. */
export type IndexRow = [string, string, string, number | null, number];

const DAY_MS = 86_400_000;
/** Postings older than this (about six months) are stale: they don't count as evidence a company hires for you. */
export const STALE_ROW_DAYS = 180;

/**
 * When an index row was posted. Ages are counted when the company was fetched, so they are anchored
 * to that (not to now): a row "2 days old" fetched 5 days ago is 7 days old today. Pass the company's
 * fetched_at, or the index's generated_at for indexes published without it.
 */
export function rowPostedAt(ageDays: number | null, generatedAt: Date): Date | undefined {
  return ageDays === null ? undefined : new Date(generatedAt.getTime() - ageDays * DAY_MS);
}

/** Where a board lives, beyond ats + slug (EU region; Workday shard and site). */
type BoardPlace = { region?: string; shard?: string; site?: string };

export type IndexedCompany = BoardPlace & {
  key: string;
  name: string;
  ats: string;
  slug: string;
  careers_url: string;
  open_jobs: number;
  rows: IndexRow[];
  /** When its jobs were fetched (row ages count from here); older indexes don't have it. */
  fetched_at?: string;
  /** Topic word -> share of the company's jobs mentioning it (only when descriptions were indexed). */
  terms?: Record<string, number>;
  tier?: "curated" | "dump";
  /** Industry ids (catalog/industries.ts) a source list or the seed list puts the company in. */
  tags?: string[];
  /** Industry ids only the company's job titles point to: what it hires for, not necessarily what it is. */
  title_tags?: string[];
};

/** A directory company without job rows: no openings right now, or not indexed yet. */
export type DirectoryCompany = Omit<IndexedCompany, "rows" | "terms" | "open_jobs"> & { open_jobs: number | null };

/**
 * Where a company hires, from its postings in the weekly index: the countries most of them name
 * (most first, up to 3) and whether a good share is remote. A fact about the company, not about
 * the user's roles. Only indexed companies have it.
 */
export type HiresIn = { remote: boolean; countries: string[] };

export type CompanySuggestion = BoardPlace & {
  key: string;
  name: string;
  ats: string;
  slug: string;
  careers_url: string;
  /** Open jobs right now; null when we haven't counted them. */
  open_jobs: number | null;
  tier?: string;
  score: number;
  /** Open jobs that pass the user's title and location filters. */
  matches: number;
  /** Matches posted in the last 7 days. */
  new_matches: number;
  /** Right title, nearby place (same region) or remote. */
  near_misses: number;
  /** Right title in a place the user didn't pick. */
  elsewhere: number;
  /** Other roles in a place the user picked: the company has a team there. */
  in_your_places: number;
  /** Up to 3 "Title (Location)" examples of matching jobs (or near misses, or the role elsewhere). */
  examples: string[];
  topics: string[];
  /** The user's industries this company is in (taxonomy ids). */
  industries: string[];
  /** The user's industries only its job titles point to ("hires for AI roles"); weaker than `industries`. */
  hires_for: string[];
  reasons: string[];
  /** Where it hires (indexed companies only). */
  hires_in?: HiresIn;
};

export type SuggestResult = {
  hiringNow: CompanySuggestion[];
  worthWatching: CompanySuggestion[];
  /** In the user's industries, but on a hiring system we can't scan yet. */
  notScannable: CompanySuggestion[];
  scanned: number;
  /** With PickOptions.mine: what each list left out because it's in your companies (best first, uncut). */
  mine?: YourSuggestions;
};

/** Suggestions that are your companies already, per list. */
export type YourSuggestions = Pick<SuggestResult, "hiringNow" | "worthWatching" | "notScannable">;

const GCC = ["united arab emirates", "saudi arabia", "qatar", "bahrain", "kuwait", "oman"];
const gccTerms = GCC.flatMap((n) => countryTerms(COUNTRIES.find((c) => c.name === n)!, true)).filter((t) => t !== "emirates");
/** Open jobs above which a company counts as a very large employer (rerankForDiversity). */
export const BIG_COMPANY_JOBS = 300;

/** If the user targets a GCC place, other GCC places count as "near". Otherwise only remote does. */
function nearRegionTerms(profile: Profile): string[] {
  const targetsGcc = profile.locations.include.some((p) => gccTerms.includes(p));
  return targetsGcc ? gccTerms : [];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capitalize = (s: string) => s.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
/** Display name for a place term: short aliases become their country ("uk" -> "United Kingdom"). */
const placeName = (term: string) => capitalize(term.length <= 3 ? (groupPlaces([term])[0]?.name ?? term) : term);
const logScale = (n: number, full: number) => Math.min(1, Math.log2(1 + n) / Math.log2(1 + full));

/** The most common keys, most frequent first. */
function top(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/**
 * Rank companies for a user, no AI.
 *
 * Hiring for you now: companies with open jobs that pass the user's own gates, ranked mainly by
 * how many (log-scaled so huge employers don't win on volume), then match quality, topic overlap
 * and near misses. Missing components are dropped and the rest rescaled to 0–100.
 *
 * Worth watching: no matching opening today, but relevant: the user's industries, the user's
 * topics in their job titles or source tags, the right role in other places, other roles in the
 * user's places, or similar roles nearby. Includes companies with no job rows at all (`others`),
 * since the point is to be watching before the next opening appears.
 *
 * Never suggested: sandbox/training/test boards (isPlaceholderBoard). Job rows older than
 * STALE_ROW_DAYS are ignored.
 *
 * Two steps, so the slow one can be kept on disk (suggest-cache.ts): rankCompanies reads every job
 * row and depends only on the profile, the index and the day; pickSuggestions leaves out the
 * companies to exclude and cuts the lists to `limit`.
 */
export function suggestCompanies(profile: Profile, companies: readonly IndexedCompany[], opts: RankOptions & PickOptions = {}): SuggestResult {
  return pickSuggestions(rankCompanies(profile, companies, opts), companies, opts);
}

export type RankOptions = {
  now?: Date;
  /** When the index was built; row ages count from here unless a company has its own fetched_at. Defaults to now. */
  indexGeneratedAt?: Date;
  others?: readonly DirectoryCompany[];
  supported?: ReadonlySet<string>;
};

export type PickOptions = {
  exclude?: ReadonlySet<string>;
  /**
   * Your companies, not counting hidden ones (all in `exclude` too): the ones left out for this are kept in `mine`, best first and
   * not cut to `limit`, so the page can tell "you've added them all" from "nothing found".
   */
  mine?: ReadonlySet<string>;
  limit?: number;
  now?: Date;
  indexGeneratedAt?: Date;
};

/** Every relevant company, best first (bySuggestion), before exclusions, the diversity rule and the limit. */
export type RankedSuggestions = {
  hiringNow: CompanySuggestion[];
  worthWatching: CompanySuggestion[];
  notScannable: CompanySuggestion[];
  scanned: number;
};

/**
 * Leave out the excluded companies, space out the giants, cut each list to `limit` and add where the
 * companies hire. Sorting is stable, so leaving companies out after ranking gives the same order as
 * leaving them out before.
 */
export function pickSuggestions(ranked: RankedSuggestions, companies: readonly IndexedCompany[], opts: PickOptions = {}): SuggestResult {
  const now = opts.now ?? new Date();
  const generatedAt = opts.indexGeneratedAt ?? now;
  const limit = opts.limit ?? 30;
  const keep = (s: CompanySuggestion) => !opts.exclude?.has(s.key);
  let indexed: Map<string, IndexedCompany> | undefined;
  // Worked out only for the companies returned: reading places is too slow for the whole index.
  const withPlaces = (s: CompanySuggestion): CompanySuggestion => {
    indexed ??= new Map(companies.map((c) => [c.key, c]));
    const c = indexed.get(s.key);
    const where = c && hiresIn(c, { now, indexGeneratedAt: generatedAt });
    return where ? { ...s, hires_in: where } : s;
  };
  const order = (list: readonly CompanySuggestion[]) => rerankForDiversity(list.filter(keep)).slice(0, limit).map(withPlaces);
  const yours = (list: readonly CompanySuggestion[]) => list.filter((s) => opts.mine?.has(s.key));
  return {
    hiringNow: order(ranked.hiringNow),
    worthWatching: order(ranked.worthWatching),
    notScannable: order(ranked.notScannable),
    scanned: ranked.scanned,
    ...(opts.mine ? { mine: { hiringNow: yours(ranked.hiringNow), worthWatching: yours(ranked.worthWatching), notScannable: yours(ranked.notScannable) } } : {}),
  };
}

/** The slow step of suggestCompanies: score every company in the index and the directory for this profile. */
export function rankCompanies(profile: Profile, companies: readonly IndexedCompany[], opts: RankOptions = {}): RankedSuggestions {
  const now = opts.now ?? new Date();
  const generatedAt = opts.indexGeneratedAt ?? now;
  const near = nearRegionTerms(profile);
  const places = profile.locations.include;
  const keywords = Object.keys(profile.keywords);
  const byWeight = [...keywords].sort((a, b) => (profile.keywords[b] ?? 0) - (profile.keywords[a] ?? 0));
  const topWeights = Object.values(profile.keywords)
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((s, w) => s + w, 0);
  const topicShare = (topics: string[]) => (topWeights > 0 ? Math.min(1, topics.reduce((s, k) => s + (profile.keywords[k] ?? 0), 0) / topWeights) : 0);
  const supported = opts.supported ?? new Set(Object.keys(connectors));
  const wanted = new Set(profile.industries);
  /** The user's industries a company is in, and the ones only its job titles point to. */
  const fitOf = (c: { tags?: readonly string[]; title_tags?: readonly string[] }) => {
    const industries = (c.tags ?? []).filter((t) => wanted.has(t));
    return { industries, hires_for: (c.title_tags ?? []).filter((t) => wanted.has(t) && !industries.includes(t)) };
  };
  const allTags = (c: { tags?: readonly string[]; title_tags?: readonly string[] }) => [...(c.tags ?? []), ...(c.title_tags ?? [])];
  /** For each industry tag, the user's highest-weighted keyword it stands for (one per tag, so synonyms don't stack). */
  const tagTopics = (tags: readonly string[] | undefined) => {
    const out: string[] = [];
    for (const t of tags ?? []) {
      const ind = INDUSTRY_BY_ID.get(t);
      const terms = [ind?.label ?? t, ...(ind ? [...ind.topics, ...ind.terms] : [])];
      const best = byWeight.find((k) => terms.some((syn) => matchesTerm(k, syn) || matchesTerm(syn, k)));
      if (best && !out.includes(best)) out.push(best);
    }
    return out;
  };
  // Compiled once: counting keyword hits across thousands of companies' titles.
  const keywordRes = keywords.map((k) => [k, new RegExp(termRegex(k).source, "giu")] as const);
  // Remembered per title and per place: the index repeats them a lot (about 270,000 titles and
  // 64,000 places in 420,000 rows), and reading one is most of the work.
  const titleOk = memo((title: string) => passesTitleGate(title, profile));
  const placeOkIn = new Map<string, (location: string) => boolean>();
  const placeOk = (workplace: string, location: string) => {
    let ok = placeOkIn.get(workplace);
    if (!ok) placeOkIn.set(workplace, (ok = memo((l: string) => passesLocationGate({ location: l, workplace: workplace as never }, profile))));
    return ok(location);
  };
  const isNear = memo((location: string) => matchesAny(location, near));
  const yourPlace = memo((location: string) => (matchesAny(location, places) ? (places.find((t) => matchesTerm(location, t)) ?? "") : ""));

  const hiring: CompanySuggestion[] = [];
  const watching: CompanySuggestion[] = [];
  for (const c of companies) {
    if (isPlaceholderBoard(c.name)) continue;
    let matches = 0;
    let fresh = 0;
    let nearMisses = 0;
    let elsewhere = 0;
    let inPlaces = 0;
    const scores: number[] = [];
    const examples: string[] = [];
    const nearExamples: string[] = [];
    const elsewhereExamples: string[] = [];
    const elsewherePlaces = new Map<string, number>();
    const ownPlaces = new Map<string, number>();
    const fetchedAt = c.fetched_at ? new Date(c.fetched_at) : generatedAt;
    const rows = c.rows.filter((r) => !isStale(r[3], fetchedAt, now));
    for (const [title, location, workplace, age, count] of rows) {
      // Cheap gate check first; full scoring only for the few jobs that pass.
      // Same as gateOf, remembered.
      const gate = !titleOk(title) ? "title" : placeOk(workplace, location) ? undefined : "location";
      const example = location ? `${title} (${location})` : title;
      if (!gate) {
        const posted = rowPostedAt(age, fetchedAt);
        matches += count;
        if (posted && now.getTime() - posted.getTime() <= 7 * DAY_MS) fresh += count;
        scores.push(scoreJob({ title, location, workplace: workplace as never, description: "" }, profile, { industries: companyIndustries(c) }).score);
        if (examples.length < 3) examples.push(example);
      } else if (gate === "location") {
        if (workplace === "remote" || isNear(location)) {
          nearMisses += count;
          if (nearExamples.length < 3) nearExamples.push(example);
        } else {
          elsewhere += count;
          if (elsewhereExamples.length < 3) elsewhereExamples.push(example);
          const place = location.split(/[,;|/]/)[0]!.trim();
          if (place) elsewherePlaces.set(place, (elsewherePlaces.get(place) ?? 0) + count);
        }
      } else {
        // Wrong title: does the company hire in one of the user's places?
        const place = yourPlace(location);
        if (place) {
          inPlaces += count;
          ownPlaces.set(place, (ownPlaces.get(place) ?? 0) + count);
        }
      }
    }

    // Topics: description terms when indexed, the user's keywords in job titles (in at least 5% of
    // them, so one stray title doesn't count), and source tags.
    const titles = rows.map((r) => r[0]).join(" | ");
    const minHits = Math.max(1, Math.ceil(rows.length * 0.05));
    const titleTopics = keywordRes.filter(([, re]) => (titles.match(re)?.length ?? 0) >= minHits).map(([k]) => k);
    const topics = [...new Set([...keywords.filter((k) => (c.terms?.[k] ?? 0) > 0), ...titleTopics, ...tagTopics(allTags(c))])].sort((a, b) => (profile.keywords[b] ?? 0) - (profile.keywords[a] ?? 0));

    const { industries, hires_for } = fitOf(c);
    const base = { ...boardOf(c), open_jobs: c.open_jobs, tier: c.tier, topics, industries, hires_for };
    const counts = { new_matches: fresh, near_misses: nearMisses, elsewhere, in_your_places: inPlaces };

    if (matches) {
      // Components and their maximum points; topics only count when this company has topic data.
      const parts: [number, number][] = [
        [50 * logScale(matches, 5), 50],
        [
          0.2 *
            (scores
              .sort((a, b) => b - a)
              .slice(0, 3)
              .reduce((s, x) => s + x, 0) /
              Math.min(3, scores.length)),
          20,
        ],
        [10 * Math.min(1, nearMisses / 3), 10],
      ];
      if ((c.terms || topics.length) && topWeights > 0) parts.push([20 * topicShare(topics), 20]);
      // Being in an industry the user picked is worth as much as a strong match count; only hiring
      // for it (job titles) is worth a third of that.
      if (wanted.size) parts.push([industries.length ? 30 : hires_for.length ? INDUSTRY_FROM_TITLES_POINTS : 0, 30]);
      const score = Math.round((parts.reduce((s, [p]) => s + p, 0) / parts.reduce((s, [, m]) => s + m, 0)) * 100);
      const reasons = [`${plural(matches, "open role")} ${matches === 1 ? "matches" : "match"} you`];
      if (industries.length) reasons.unshift(industryReason(industries));
      else if (hires_for.length) reasons.unshift(hiresReason(hires_for));
      if (fresh) reasons.push(`${fresh} new this week`);
      if (topics.length) reasons.push(`Your topics: ${topics.slice(0, 3).join(", ")}`);
      hiring.push({ ...base, ...counts, score, matches, examples, reasons });
      continue;
    }

    const s = watchSuggestion(
      { ...base, ...counts, matches: 0, examples: nearExamples.length ? nearExamples : elsewhereExamples },
      { topicShare: topicShare(topics), elsewherePlaces: top(elsewherePlaces, 2), ownPlaces: top(ownPlaces, 3) },
    );
    if (s) watching.push(s);
  }

  // Companies with no job rows: only the industry and source tags can say they're
  // relevant. Ones on hiring systems we can't scan yet get their own list.
  const notScannable: CompanySuggestion[] = [];
  for (const c of opts.others ?? []) {
    if (isPlaceholderBoard(c.name)) continue;
    const topics = tagTopics(allTags(c));
    const { industries, hires_for } = fitOf(c);
    const s = watchSuggestion(
      {
        ...boardOf(c),
        open_jobs: c.open_jobs,
        tier: c.tier,
        topics,
        industries,
        hires_for,
        matches: 0,
        new_matches: 0,
        near_misses: 0,
        elsewhere: 0,
        in_your_places: 0,
        examples: [],
      },
      { topicShare: topicShare(topics), elsewherePlaces: [], ownPlaces: [] },
    );
    if (!s) continue;
    if (!supported.has(c.ats)) {
      // Only companies in the user's industries: nothing else says one is for them.
      if (industries.length) notScannable.push(s);
    } else watching.push(s);
  }

  return {
    hiringNow: hiring.sort(bySuggestion),
    worthWatching: watching.sort(bySuggestion),
    notScannable: notScannable.sort(bySuggestion),
    scanned: companies.length + (opts.others?.length ?? 0),
  };
}

/** f, remembered per argument (f never returns undefined). */
function memo<T>(f: (key: string) => T): (key: string) => T {
  const seen = new Map<string, T>();
  return (key) => {
    let v = seen.get(key);
    if (v === undefined) seen.set(key, (v = f(key)));
    return v;
  };
}

/** A country counts when at least this share of a company's postings name it; remote, this share of them. */
const COUNTRY_SHARE = 0.1;
const REMOTE_SHARE = 0.2;
const REMOTE = /\bremote\b/i;
const countryCache = new Map<string, string[]>();
function countriesOf(location: string): string[] {
  let c = countryCache.get(location);
  if (!c) {
    if (countryCache.size > 50_000) countryCache.clear();
    countryCache.set(location, (c = countriesIn(location)));
  }
  return c;
}

/**
 * Where a company hires, from its newest 150 postings that aren't stale: the countries named by at
 * least a tenth of them (most first, up to 3) and remote when a fifth or more are. Undefined when
 * the postings name no place.
 */
export function hiresIn(c: Pick<IndexedCompany, "rows" | "fetched_at">, opts: { now?: Date; indexGeneratedAt?: Date } = {}): HiresIn | undefined {
  const now = opts.now ?? new Date();
  const fetchedAt = c.fetched_at ? new Date(c.fetched_at) : (opts.indexGeneratedAt ?? now);
  const byCountry = new Map<string, number>();
  let total = 0;
  let remote = 0;
  for (const [, location, workplace, age, count] of c.rows.slice(0, 150)) {
    if (isStale(age, fetchedAt, now)) continue;
    total += count;
    if (workplace === "remote" || REMOTE.test(location)) remote += count;
    for (const country of countriesOf(location)) byCountry.set(country, (byCountry.get(country) ?? 0) + count);
  }
  if (!total) return undefined;
  const countries = [...byCountry.entries()]
    .filter(([, n]) => n >= total * COUNTRY_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => name);
  const isRemote = remote >= total * REMOTE_SHARE;
  return countries.length || isRemote ? { remote: isRemote, countries } : undefined;
}

const industryLabels = (ids: string[]) => ids.map((id) => INDUSTRY_BY_ID.get(id)?.label ?? id).join(", ");
const industryReason = (ids: string[]) => `Your industry: ${industryLabels(ids)}`;
const hiresReason = (ids: string[]) => `Hires for ${industryLabels(ids)} roles`;
/** Points (of 30) for an industry only the job titles point to. */
const INDUSTRY_FROM_TITLES_POINTS = 10;

/** A row posted more than STALE_ROW_DAYS ago (rows without an age are kept). */
function isStale(ageDays: number | null, fetchedAt: Date, now: Date): boolean {
  const posted = rowPostedAt(ageDays, fetchedAt);
  return !!posted && now.getTime() - posted.getTime() > STALE_ROW_DAYS * DAY_MS;
}

/** Identity fields a suggestion carries over (enough to add the company to a watchlist). */
function boardOf(c: DirectoryCompany | IndexedCompany) {
  return {
    key: c.key,
    name: c.name,
    ats: c.ats,
    slug: c.slug,
    careers_url: c.careers_url,
    ...(c.region ? { region: c.region } : {}),
    ...(c.shard ? { shard: c.shard } : {}),
    ...(c.site ? { site: c.site } : {}),
  };
}

/** Score a company with no matching opening on a fixed 0–100 scale; null when nothing makes it relevant. */
function watchSuggestion(s: Omit<CompanySuggestion, "score" | "reasons">, extra: { topicShare: number; elsewherePlaces: string[]; ownPlaces: string[] }): CompanySuggestion | null {
  const industry = s.industries.length > 0;
  const hires = s.hires_for.length > 0;
  if (!industry && !hires && !s.topics.length && !s.near_misses && !s.elsewhere && !s.in_your_places) return null;
  const raw =
    (industry ? 30 : hires ? INDUSTRY_FROM_TITLES_POINTS : 0) +
    (s.topics.length ? 25 * Math.max(0.4, extra.topicShare) : 0) +
    15 * logScale(s.elsewhere, 5) +
    20 * logScale(s.near_misses, 3) +
    15 * logScale(s.in_your_places, 10);
  const score = Math.min(100, Math.round(raw));
  const reasons: string[] = [];
  if (industry) reasons.push(industryReason(s.industries));
  else if (hires) reasons.push(hiresReason(s.hires_for));
  if (s.near_misses) reasons.push(`${plural(s.near_misses, "similar role")} nearby or remote`);
  if (s.elsewhere) reasons.push(`Hires for your roles in ${extra.elsewherePlaces.join(", ")}`);
  if (s.in_your_places) reasons.push(`Hiring in ${[...new Set(extra.ownPlaces.map(placeName))].slice(0, 2).join(", ")} (other roles)`);
  if (s.topics.length) reasons.push(`Your topics: ${s.topics.slice(0, 3).join(", ")}`);
  return { ...s, score, reasons };
}

function bySuggestion(a: CompanySuggestion, b: CompanySuggestion): number {
  // Companies in the user's industries first; then score, then
  // the bigger matching count, then the name.
  return Number(b.industries.length > 0) - Number(a.industries.length > 0) || b.score - a.score || b.matches - a.matches || a.name.localeCompare(b.name);
}

/**
 * At most 3 very large employers in any 12 consecutive results, so the list isn't all giants.
 * A giant that doesn't fit waits only until the window has room, then takes the next slot.
 */
function rerankForDiversity(list: CompanySuggestion[]): CompanySuggestion[] {
  const big = (s: CompanySuggestion) => (s.open_jobs ?? 0) > BIG_COMPANY_JOBS;
  const out: CompanySuggestion[] = [];
  const held: CompanySuggestion[] = [];
  const room = () => out.slice(-11).filter(big).length < 3;
  for (const s of list) {
    // Held giants ranked higher than s, so they go first as soon as they fit.
    while (held.length && room()) out.push(held.shift()!);
    if (big(s) && !room()) held.push(s);
    else out.push(s);
  }
  // Only giants left: nothing to space them with.
  return [...out, ...held];
}
