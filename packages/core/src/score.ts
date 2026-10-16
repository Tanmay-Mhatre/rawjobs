import { INDUSTRY_BY_ID } from "./catalog/industries";
import { SENIORITY_LEVELS, seniorityCue, seniorityGap, seniorityOf, type Seniority } from "./catalog/seniority";
import { allPlaceNames, countriesIn, expandPlaces, LOCATION_SEGMENTS, placeOwner, placeOwnerName, spellOutPlaces, SUBDIVISIONS } from "./catalog/places";
import { dealbreakers, eligibilityChecks } from "./dealbreakers";
import { regionOnly } from "./posting";
import type { FitCheck, NormalizedJob, Profile, ScoreBreakdown } from "./schema";
import { matchesAny, matchesTerm, matchesTitle, mayMatchTitle, mentionsOf, termRegex, titleForms } from "./text";

export const POINTS = {
  titleMatch: 20,
  /** The part of titleMatch that depends on focus: how much of the title your role words explain. */
  titleFocus: 5,
  seniority: 10,
  /** The title's level is one step from the levels your seniority words name (Senior vs a plain title). */
  seniorityNear: 5,
  locationCity: 20,
  locationRemote: 15,
  keywordCap: 40,
  /** Matched topic weight that fills the topic bar (about three core topics at weight 4). */
  keywordTarget: 12,
  /** Most topic points a job's title alone can give: half the bar, so a description can still prove more. */
  titleKeywordCap: 20,
  /** The company is in one of your industries (or is one of yours, or you picked no industries). */
  industryMatch: 10,
  /** Nobody has told us the company's industry: half, so an untagged company isn't pushed down. */
  industryUnknown: 5,
  /** Weight of the topics your industries add (payments, trading…) when you haven't listed them yourself... */
  industryTopic: 2,
  /** ...and the most they add together: two topics' worth, a lift, never a full bar. */
  industryTopicCap: 4,
  /** A topic the description names once counts this share of its weight... */
  oneMention: 0.75,
  /** ...and in full from this many mentions (or when it's in the title). */
  fullMentions: 3,
} as const;

type Scorable = Pick<NormalizedJob, "title" | "location" | "workplace" | "description"> & Partial<Pick<NormalizedJob, "salary">>;

/** What's known about the job's company, for the industry part. */
export type CompanyFit = {
  /** The company's industry ids; undefined when unknown. */
  industries?: readonly string[];
  /** One of your companies: always counts as your industry. */
  tracked?: boolean;
};

/** Most points title + location + industry can give (30 + 20 + 10). */
const NON_KEYWORD_MAX = POINTS.titleMatch + POINTS.seniority + POINTS.locationCity + POINTS.industryMatch;

/**
 * Transparent keyword scoring, 0..100. No AI.
 *
 *   title      15, up to +5 by focus (the share of the title's words your role and level words explain:
 *              "Senior Product Designer" all of them; words after a comma or dash count half, so
 *              "Product Designer, Growth Platform" a little less),
 *              +10 at your level (a seniority word in the title, or the same level as one),
 *              +5 one level away (a plain "Product Manager" for a senior), +0 two or more (Director, Junior)
 *   location   20 one of your places, 15 remote in your regions
 *   topics     up to 40: the share of your topic weight a job mentions, where min(total weight, 12)
 *              fills the bar (so three core topics are enough; a short list isn't penalised). A topic
 *              named once counts three quarters of its weight, three times (or in the title) in full.
 *              A topic in the title counts on its own too: up to 20, your top topic filling it, so
 *              jobs with no description ("Payments PM") aren't 0 on topics. The title is part of
 *              every job, so this never puts a job without a description ahead of the same job with one.
 *              Your industries add their topics you didn't list at weight 2, at most 4 together (topicsOf).
 *   industry   10 the company is in one of your industries (or is yours), 5 not known, 0 another industry
 * With no topics at all, title + location + industry (max 60) is scaled to 0..100 (`why.scale`).
 * Parts are kept unrounded until the end, so jobs that differ a little score a little differently.
 * `why.checks` says, for place, level, pay and visa, whether the job meets yours or the posting doesn't say.
 *
 * Dealbreakers (dealbreakers.ts: pay under your floor, no sponsorship where you'd need it, residents of
 * another country only, work you avoid) halve the score and keep it under your min_score, with the
 * reasons in `why.dealbreakers`: the job still shows, but never as a strong match.
 *
 * The score is how well a job fits, never how old it is: recency is part of the Radar's order
 * (rankScore), worked out when you look, so it doesn't go stale between scans.
 *
 * Gates: the title must match an include term and no exclude term, and the location must be one
 * the user picked (see locationFit). Failing a gate scores 0.
 */
export function scoreJob(job: Scorable, profile: Profile, company: CompanyFit = {}): { score: number; why: ScoreBreakdown } {
  const title = job.title;
  const forms = titleForms(title);
  const location = withTitleRegion(gateLocation(job), title);
  const titleOk = titlePasses(title, profile, forms);
  const focus = titleOk ? titleFocus(title, profile) : 0;
  const level = titleOk ? seniorityPoints(title, profile, forms) : 0;
  const titlePts = titleOk ? POINTS.titleMatch - POINTS.titleFocus * (1 - focus) + level : 0;
  const fit = workplaceFit(job, profile) ?? locationFit(location, profile);
  const locationPts = fit.points;

  const description = job.description ?? "";
  const keywords = topicsOf(profile);
  const inTitle = new Set(Object.keys(keywords).filter((k) => matchesTitle(title, [k], forms)));
  // How strongly each topic is there: in full in the title or from fullMentions mentions, oneMention for one.
  const strength = new Map<string, number>();
  for (const k of Object.keys(keywords)) {
    const n = inTitle.has(k) ? POINTS.fullMentions : mentionsOf(description, k, POINTS.fullMentions);
    if (n) strength.set(k, POINTS.oneMention + ((1 - POINTS.oneMention) * (n - 1)) / (POINTS.fullMentions - 1));
  }
  const matched = Object.entries(keywords)
    .filter(([k]) => strength.has(k))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Your own topics set the bar; your industries' topics add at most industryTopicCap of weight to it.
  const own = (k: string) => k in profile.keywords;
  const weights = Object.values(profile.keywords);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const weigh = (list: [string, number][], by: (k: string) => number) =>
    list.reduce((sum, [k, w]) => sum + (own(k) ? w * by(k) : 0), 0) +
    Math.min(
      POINTS.industryTopicCap,
      list.reduce((sum, [k, w]) => sum + (own(k) ? 0 : w * by(k)), 0),
    );
  const matchedWeight = weigh(matched, (k) => strength.get(k) ?? 0);
  const titleWeight = weigh(
    matched.filter(([k]) => inTitle.has(k)),
    () => 1,
  );
  const keywordPoints =
    totalWeight > 0
      ? Math.max(POINTS.keywordCap * Math.min(1, matchedWeight / Math.min(totalWeight, POINTS.keywordTarget)), POINTS.titleKeywordCap * Math.min(1, titleWeight / Math.max(...weights)))
      : 0;
  const missing = Object.entries(profile.keywords)
    .filter(([k]) => !strength.has(k))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([k]) => k);

  const industry = industryFit(company, profile);

  const why: ScoreBreakdown = {
    title: tenths(titlePts),
    level,
    focus: Math.round(focus * 100) / 100,
    location: locationPts,
    keywords: matched.map(([k]) => k),
    keywordPoints: tenths(keywordPoints),
    industry,
    ...(missing.length ? { missing } : {}),
    ...(totalWeight > 0 ? {} : { scale: 100 / NON_KEYWORD_MAX }),
  };
  if (!titleOk) return { score: 0, why: { ...why, gate: "title" } };
  if (locationPts === 0) return { score: 0, why: { ...why, gate: "location", ...(fit.note ? { locationNote: fit.note } : {}) } };
  why.checks = [...fitChecks(job.title, locationPts, level, profile), ...eligibilityChecks(job, profile)];
  const exact = Math.min(100, (titlePts + locationPts + keywordPoints + industry) * (why.scale ?? 1));
  const broken = dealbreakers(job, profile);
  if (!broken.length) return { score: Math.round(exact), why };
  return { score: Math.max(0, Math.min(Math.round(exact / 2), profile.min_score - 1)), why: { ...why, dealbreakers: broken } };
}

const tenths = (n: number) => Math.round(n * 10) / 10;

/** Place (always met once the job passes the location gate) and level (when your seniority words name one). */
function fitChecks(title: string, locationPts: number, level: number, profile: Profile): FitCheck[] {
  const out: FitCheck[] = [{ id: "place", status: "met", note: locationPts === POINTS.locationCity ? "In one of your places" : "Remote, open where you are" }];
  if (profile.seniority_boost.length) {
    const label = SENIORITY_LEVELS.find((l) => l.id === seniorityOf(title))?.label ?? "Mid-level";
    if (level === POINTS.seniority) out.push({ id: "level", status: "met", note: "At your level" });
    else if (level === POINTS.seniorityNear) out.push({ id: "level", status: "near", note: `${label}: one level from yours` });
    else if (targetLevels(profile).length) out.push({ id: "level", status: "missed", note: `${label}: not your level` });
  }
  return out;
}

/** Words in a title that say nothing about the role (how or where it's worked): they neither help nor hurt focus. */
const FILLER = new Set(
  "and of the for in at with to a an on or & remote hybrid onsite site office contract contractor freelance temporary temp interim permanent full part time fixed term".split(" "),
);
/** The role part of a title: what comes before a comma, dash, bracket or colon ("Product Designer, Payments" -> "Product Designer"). */
const ROLE_END = /\s+[-–—/|:]\s+|[,;()[\]–—|:]/;
const formWords = (s: string) => (titleForms(s).split(" | ")[0] ?? "").split(" ").filter(Boolean);
const knownCache = new WeakMap<Profile, string[]>();

/**
 * Share of the title's words that your titles, levels and topics explain, 0..1, abbreviations spelt
 * out: "Senior Product Designer" 1 for a product designer, "Senior Technical Product Designer" 3 of 4.
 * Words after the role (", Payments", " - Growth") count half: they narrow the role rather than name it.
 * A word counts when it shares its first five letters with one of yours.
 */
export function titleFocus(title: string, profile: Profile): number {
  let known = knownCache.get(profile);
  if (!known) knownCache.set(profile, (known = [...new Set([...profile.titles.include, ...profile.seniority_boost, ...Object.keys(profile.keywords)].flatMap(formWords))]));
  const explained = (w: string) => !!seniorityCue(w) || known.some((k) => k === w || (Math.min(k.length, w.length) >= 4 && k.slice(0, 5) === w.slice(0, 5)));
  const [role = title, ...after] = title.split(ROLE_END);
  const weighed = [...formWords(role).map((w) => [w, 1] as const), ...after.flatMap(formWords).map((w) => [w, 0.5] as const)].filter(([w]) => !FILLER.has(w) && !/^\d/.test(w));
  const total = weighed.reduce((s, [, x]) => s + x, 0);
  return total ? weighed.reduce((s, [w, x]) => s + (explained(w) ? x : 0), 0) / total : 1;
}

const levelsCache = new WeakMap<readonly string[], Seniority[]>();

/** The levels your seniority words name ("senior", "lead" -> senior, principal). Words with no level ("group") add none. */
function targetLevels(profile: Profile): Seniority[] {
  let out = levelsCache.get(profile.seniority_boost);
  if (!out) {
    out = [...new Set(profile.seniority_boost.map(seniorityCue).filter((l): l is Seniority => !!l))];
    levelsCache.set(profile.seniority_boost, out);
  }
  return out;
}

/**
 * How close the title's level is to yours: 10 at your level, 5 one step away, 0 further.
 * With no seniority words there is no level to compare, and nothing is added.
 */
function seniorityPoints(title: string, profile: Profile, forms: string): number {
  if (matchesTitle(title, profile.seniority_boost, forms)) return POINTS.seniority;
  const levels = targetLevels(profile);
  if (!levels.length) return 0;
  const gap = Math.min(...levels.map((l) => seniorityGap(l, seniorityOf(title))));
  return gap === 0 ? POINTS.seniority : gap === 1 ? POINTS.seniorityNear : 0;
}

/** 10 your industry (or your company, or you picked none), 5 not known, 0 known and another one. */
function industryFit(company: CompanyFit, profile: Profile): number {
  if (company.tracked || !profile.industries.length) return POINTS.industryMatch;
  if (!company.industries?.length) return POINTS.industryUnknown;
  return company.industries.some((i) => profile.industries.includes(i)) ? POINTS.industryMatch : 0;
}

const topicsCache = new WeakMap<Profile, Record<string, number>>();

/**
 * Your topics, plus each of your industries' topics you didn't list (weight industryTopic): a payments
 * PM role is worth something to someone in payments even when their topics are all about crypto.
 * They never change where the bar fills (your own topics set that), and add at most industryTopicCap.
 * With no topics of your own, none are added: the score stays title, place and industry.
 */
export function topicsOf(profile: Profile): Record<string, number> {
  let out = topicsCache.get(profile);
  if (out) return out;
  out = { ...profile.keywords };
  if (Object.keys(out).length) {
    const listed = new Set(Object.keys(out).map((k) => k.toLowerCase()));
    for (const id of profile.industries)
      for (const t of INDUSTRY_BY_ID.get(id)?.topics ?? []) {
        if (listed.has(t.toLowerCase())) continue;
        listed.add(t.toLowerCase());
        out[t] = POINTS.industryTopic;
      }
  }
  topicsCache.set(profile, out);
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANK = {
  /** Extra for one of your companies: a nudge, not a wall. */
  tracked: 10,
  /** What freshness is worth on the day a job is posted... */
  fresh: 15,
  /** ...halving every this many days. */
  halfLifeDays: 3,
  /** Past this age a posting starts to lose rank: most roles are filled in 45-60 days... */
  staleAfterDays: 30,
  /** ...this much a day... */
  stalePerDay: 0.15,
  /** ...up to this much (reached at 110 days). */
  staleCap: 12,
} as const;

/**
 * The "best match" order: fit, a nudge for your companies, and freshness that halves every three days,
 * so a strong job posted today beats an equal one from last week, and a weak one never leaps a strong one.
 * After a month a posting loses rank a little each day, as it's more and more likely to be filled.
 *   rank = score + 10 (your company) + 15 x 0.5^(age in days / 3) - min(12, 0.15 x (age - 30))
 * Worked out when the list is shown, so it never goes stale. Dates in the future count as today; no date costs nothing.
 */
export function rankScore(score: number, postedOrSeen: string | undefined, now: number, tracked = false): number {
  const t = postedOrSeen ? Date.parse(postedOrSeen) : NaN;
  const age = Number.isNaN(t) ? Infinity : Math.max(0, (now - t) / DAY_MS);
  const stale = Number.isFinite(age) ? Math.min(RANK.staleCap, Math.max(0, age - RANK.staleAfterDays) * RANK.stalePerDay) : 0;
  return score + (tracked ? RANK.tracked : 0) + RANK.fresh * 0.5 ** (age / RANK.halfLifeDays) - stale;
}

/** An on-site or hybrid job when the user only takes the other kind: fails the location gate. */
function workplaceFit(job: Pick<NormalizedJob, "workplace">, profile: Profile): { points: 0; note: string } | undefined {
  const allowed = profile.locations.workplace ?? [];
  if (!allowed.length || (job.workplace !== "onsite" && job.workplace !== "hybrid") || allowed.includes(job.workplace)) return undefined;
  return { points: 0, note: job.workplace === "hybrid" ? "Hybrid role: you asked for on-site only." : "On-site role: you asked for hybrid only." };
}

/** A remote job counts as "remote" even when its location text doesn't say so. */
function gateLocation(job: Pick<NormalizedJob, "location" | "workplace">): string {
  return job.workplace === "remote" && !matchesTerm(job.location, "remote") ? `${job.location} remote` : job.location;
}

/**
 * A remote job whose title limits it to one region ("Product Owner (EU only)") is remote there only:
 * the region joins the location, so locationFit checks it like "Remote - EU".
 */
function withTitleRegion(location: string, title: string): string {
  if (!matchesTerm(location, "remote")) return location;
  const region = regionOnly(title);
  return region && !matchesTerm(location, region) ? `${location} - ${region}` : location;
}

/** Include and exclude terms are read the same way (matchesTitle): "Sr. PMM" is still "product marketing". */
function titlePasses(title: string, profile: Profile, forms?: string): boolean {
  // The quick check first: most titles share no telling word with your roles, and skip the full reading.
  if (!mayMatchTitle(title, profile.titles.include)) return false;
  const f = forms ?? titleForms(title);
  return matchesTitle(title, profile.titles.include, f) && !matchesTitle(title, profile.titles.exclude, f);
}

/** Remote wording that names no place: stripped before checking what else a remote job names. */
const REMOTE_WORDS =
  /\b(fully|100%|100 %|remote|remotely|first|friendly|work from home|work-from-home|wfh|home[- ]based|from home|anywhere|any ?time ?zone|timezone|time zone|flexible|distributed|telecommute|virtual|or|and|only|within|based|in|position|role|team|location|locations|opportunity)\b/gi;
const GENERIC_REMOTE = ["remote", "anywhere", "worldwide", "global"];

type LocationRules = {
  include: string[];
  /** States and provinces of the countries the user picked ("california", "ontario"). */
  subdivisions: string[];
  /** Their codes after a comma or bracket, upper case only: "Santa Monica, CA". */
  codes: RegExp | null;
  /** remote_ok terms that name a region or place (everything except plain "remote"). */
  regions: string[];
  /** remote_ok terms written with "remote" ("remote - us", "US remote"): the place, for remote jobs only. */
  remoteRegions: string[];
  /** The user takes remote jobs that name no place at all. */
  bareRemote: boolean;
  exclude: string[];
  /** Longer place names that contain one of the user's terms but are somewhere else. */
  mask: RegExp | null;
};
/** "remote - us", "US remote", "Remote (USA)" -> "us" / "usa"; undefined when the term isn't remote plus a place. */
function remotePlace(term: string): string | undefined {
  if (!matchesTerm(term, "remote")) return undefined;
  const place = term
    .toLowerCase()
    .replace(/\bremote\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return place || undefined;
}

const rulesCache = new WeakMap<Profile["locations"], LocationRules>();

function rulesFor(profile: Profile): LocationRules {
  const loc = profile.locations;
  let rules = rulesCache.get(loc);
  if (!rules) {
    // Every name of each place ("sf" is "san francisco"), and "remote (usa)" read as "usa" for remote jobs.
    const include = expandPlaces(loc.include);
    const plainOk = loc.remote_ok.filter((t) => t.toLowerCase() !== "remote" && !remotePlace(t));
    const regions = expandPlaces(plainOk);
    const remoteRegions = expandPlaces(loc.remote_ok.map(remotePlace).filter((t): t is string => !!t));
    const exclude = expandPlaces(loc.remote_exclude.map((t) => remotePlace(t) ?? t));
    const mine = [...include, ...regions, ...remoteRegions, ...exclude];
    const owners = new Map(mine.map((t) => [t, placeOwner(t)]));
    // "New South Wales" hides "wales", "North America" hides "america", unless the user picked them
    // or they belong to the same place ("united arab emirates" never hides "emirates").
    const hide = allPlaceNames().filter((p) => p.includes(" ") && !mine.includes(p) && mine.some((t) => t !== p && matchesTerm(p, t) && (!owners.get(t) || owners.get(t) !== placeOwner(p))));
    // Countries the user picked (by any of their names or cities).
    const countries = new Set(
      include
        .map((t) => placeOwner(t))
        .filter((o): o is string => !!o?.startsWith("country:"))
        .map((o) => o.slice(8)),
    );
    const subs = [...countries].map((c) => SUBDIVISIONS[c]).filter((x) => !!x);
    const codes = subs.flatMap((x) => x!.codes);
    rules = {
      include,
      subdivisions: subs.flatMap((x) => x!.names),
      codes: codes.length ? new RegExp(`(?:,\\s*|\\()(?:${codes.join("|")})(?![\\p{L}])`, "u") : null,
      regions,
      remoteRegions,
      bareRemote: loc.remote_ok.some((t) => GENERIC_REMOTE.includes(t.toLowerCase())),
      exclude,
      mask: hide.length ? new RegExp(hide.map((p) => `(?:${termRegex(p).source})`).join("|"), "giu") : null,
    };
    rulesCache.set(loc, rules);
  }
  return rules;
}

/**
 * Does the location name one of the user's places? Checked per segment ("Dubai; London"), and a
 * picked city only counts when that segment doesn't put it in another country: "Cambridge, MA USA"
 * isn't the UK's Cambridge, "London, Ontario" isn't the UK's London.
 */
function inYourPlaces(text: string, r: LocationRules): boolean {
  if (!(matchesAny(text, r.include) || matchesAny(text, r.subdivisions) || r.codes?.test(text))) return false;
  for (const segment of text.split(LOCATION_SEGMENTS)) {
    if (matchesAny(segment, r.subdivisions) || r.codes?.test(segment)) return true;
    const hits = r.include.filter((t) => matchesTerm(segment, t));
    if (!hits.length) continue;
    const named = countriesIn(segment).map((c) => c.toLowerCase());
    if (!named.length) return true;
    if (
      hits.some((t) => {
        const owner = placeOwner(t);
        return !owner?.startsWith("country:") || named.includes(owner.slice(8));
      })
    )
      return true;
  }
  return false;
}

/**
 * Is this a place the user picked?
 *   +20  it names one of their places (the longest place name wins: "New South Wales" isn't "wales")
 *   +15  it names a remote region they picked (EMEA, GCC, worldwide…), unless it names an excluded one
 *   +15  it's remote and names no place at all ("Remote", "Fully remote")
 *    0   anything else, with a note when it's remote but tied to somewhere else ("Remote - India")
 */
export function locationFit(location: string, profile: Profile): { points: number; note?: string } {
  const r = rulesFor(profile);
  // "U.S." -> "US", "D.C." -> "DC", so abbreviations match like the plain words.
  const plain = location
    .replace(/\bU\.S\.A\.?/g, "USA")
    .replace(/\bU\.S\.?/g, "US")
    .replace(/\bD\.C\.?/g, "DC");
  const spelled = spellOutPlaces(plain);
  const text = r.mask ? spelled.replace(r.mask, " ") : spelled;
  if (inYourPlaces(text, r)) return { points: POINTS.locationCity };
  const excluded = matchesAny(text, r.exclude);
  const remote = matchesTerm(location, "remote");
  if (!excluded && (remote ? matchesAny(text, r.regions) || matchesAny(text, r.remoteRegions) : namesRegion(text, r.regions))) return { points: POINTS.locationRemote };
  if (!remote) return { points: 0 };
  // What's left once remote wording and punctuation are gone is a place: the job is remote there only.
  const rest = plain
    .replace(REMOTE_WORDS, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // "Remote (Worldwide)", "Remote - Anywhere": open to everyone, so plain remote.
  const anywhere = !!rest && rest.split(" ").every((w) => GENERIC_REMOTE.includes(w.toLowerCase()));
  if ((!rest || anywhere) && r.bareRemote && !excluded) return { points: POINTS.locationRemote };
  if (!rest) return { points: 0 };
  const known = allPlaceNames().find((p) => matchesTerm(rest, p));
  const where = known && placeOwnerName(known);
  return { points: 0, note: where ? `Remote, but only in ${where}: not one of your places.` : `Remote, but limited to "${rest.slice(0, 40)}": not one of your places.` };
}

/** Office words around a place: "Home based - EMEA", "Europe (Hybrid)". */
const OFFICE_WORDS = /\b(?:hybrid|on[- ]?site|office|home|based|in)\b/gi;
/** Pieces of one place in a location: "EMEA > BEL > Antwerp", "Home based - EMEA". Commas split places. */
const PLACE_PIECES = /\s*>\s*|\s+[-–—]\s+/;

/**
 * An office job in one of your remote regions counts when the region is a piece of its location of its
 * own ("Stein, EU", "Novi Sad, Serbia, EMEA", "EMEA > BEL > Antwerp"), with only places or office words
 * before it after a dash ("Home based - EMEA"); not when the name sits inside other text: "FXE-EU/GBR" is
 * a FedEx site code, "Holmes Beach - Gulf" a street in a US branch list.
 */
function namesRegion(text: string, regions: readonly string[]): boolean {
  if (!regions.length || !matchesAny(text, regions)) return false;
  const clean = (s: string) =>
    s
      .replace(OFFICE_WORDS, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase();
  const isPlace = (p: string) => !p || regions.includes(p) || !!placeOwner(p) || countriesIn(p).length > 0;
  return text
    .split(LOCATION_SEGMENTS)
    .flatMap((s) => s.split(","))
    .some((part) => {
      const pieces = part.split(PLACE_PIECES).map(clean);
      const at = pieces.findIndex((p) => regions.includes(p));
      return at >= 0 && pieces.slice(0, at).every(isPlace);
    });
}

/** Which gate a job fails (title is checked first), or undefined if it passes both. No scoring. */
export function gateOf(job: Pick<NormalizedJob, "title" | "location" | "workplace">, profile: Profile): "title" | "location" | undefined {
  if (!passesTitleGate(job.title, profile)) return "title";
  return passesLocationGate(job, profile) ? undefined : "location";
}

/** The title half of gateOf, for callers that check many jobs and remember results per title. */
export const passesTitleGate = (title: string, profile: Profile): boolean => titlePasses(title, profile);

/** The location half of gateOf (place and way of working), for callers that remember results per location. */
export function passesLocationGate(job: Pick<NormalizedJob, "location" | "workplace">, profile: Profile): boolean {
  if (workplaceFit(job, profile)) return false;
  return !!locationFit(gateLocation(job), profile).points;
}

/** Title-and-location gate only; cheap check before expensive detail calls. */
export function passesGates(job: Pick<NormalizedJob, "title" | "location" | "workplace">, profile: Profile): boolean {
  return gateOf(job, profile) === undefined;
}
