import { COUNTRIES } from "@rawjobs/core/catalog/places";
import { allTitles } from "@rawjobs/core/catalog/roles";
import { employersFromResume } from "@rawjobs/core/employers";
import { detectFromResume, type AiProfile } from "@rawjobs/core/resume-parse";
import { CV_DICTIONARY } from "../setup/presets";
import { inferFamily, type Draft } from "./setup";

export type Suggestions = {
  titles: string[];
  seniority: string[];
  exclude: string[];
  places: string[];
  remote: boolean;
  remoteRegions: string[];
  keywords: [string, number][];
  /** Industry ids, strongest first. */
  industries: string[];
  /** Why each industry is suggested (offline only): its most mentioned terms, with counts. */
  industryWhy: Record<string, [string, number][]>;
  /** Mentions per suggested industry (offline only). */
  industryCounts: Record<string, number>;
  /** The resume is an unfilled template: its placeholders. Nothing is suggested from it. */
  template: string[] | null;
  /** Companies worked at, newest first. */
  pastEmployers: string[];
  /** Where they came from, for the UI label. */
  source: "ai" | "resume" | null;
};

export const NO_SUGGESTIONS: Suggestions = {
  titles: [],
  seniority: [],
  exclude: [],
  places: [],
  remote: false,
  remoteRegions: [],
  keywords: [],
  industries: [],
  industryWhy: {},
  industryCounts: {},
  template: null,
  pastEmployers: [],
  source: null,
};

const TITLES = allTitles().map((t) => t.title);
const uniq = (xs: string[]) => [...new Set(xs)];
/** Offline, an industry is pre-selected only when the resume names it this often, and at most this many. */
const PRESELECT_MENTIONS = 3;
const PRESELECT_MAX = 3;

/** The AI profile block wins where present; offline detection on the resume text fills the gaps. */
export function buildSuggestions(resumeText: string, ai?: AiProfile): Suggestions {
  if (!resumeText.trim() && !ai) return NO_SUGGESTIONS;
  const found = detectFromResume(resumeText, { titles: TITLES, countries: COUNTRIES, keywords: CV_DICTIONARY });
  // An unfilled template says nothing about the person (the AI profile, when there is one, still does).
  if (found.template && !ai) return { ...NO_SUGGESTIONS, template: found.template, source: "resume" };
  const keywords = new Map<string, number>(found.keywords);
  for (const [k, w] of Object.entries(ai?.keywords ?? {})) keywords.set(k, w);
  return {
    titles: uniq([...(ai?.target_titles ?? []), ...(ai?.target_titles.length ? [] : found.titles)]),
    seniority: ai?.seniority ?? [],
    exclude: ai?.exclude_titles ?? [],
    // With an AI profile, places are where they want to work; offline we only know where they've worked.
    places: ai?.locations.length ? ai.locations : found.places.slice(0, 10),
    remote: ai?.open_to_remote ?? false,
    remoteRegions: ai?.remote_regions ?? [],
    keywords: [...keywords].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    industries: ai?.industries.length ? ai.industries : found.industries,
    industryWhy: ai?.industries.length ? {} : (found.industryWhy ?? {}),
    industryCounts: ai?.industries.length ? {} : (found.industryCounts ?? {}),
    template: null,
    pastEmployers: ai?.past_employers?.length ? ai.past_employers : employersFromResume(resumeText),
    source: ai ? "ai" : "resume",
  };
}

/** Fill only what's still empty; never overwrite choices the user already made. */
export function prefillDraft(d: Draft, s: Suggestions): Partial<Draft> {
  const patch: Partial<Draft> = {};
  if (!d.include.length && s.titles.length) {
    patch.include = s.titles.slice(0, 10);
    patch.family = d.family ?? inferFamily(patch.include);
  }
  if (!d.seniority.length && s.seniority.length) patch.seniority = s.seniority;
  if (!d.exclude.length && s.exclude.length) patch.exclude = s.exclude;
  // Past job locations aren't necessarily targets: only prefill places the AI was asked for explicitly.
  if (!d.places.length && s.places.length && s.source === "ai") patch.places = s.places;
  if (!d.remote && !d.remoteOk.length && s.remote && s.remoteRegions.length) {
    patch.remote = true;
    patch.remoteOk = s.remoteRegions;
  }
  if (!Object.keys(d.keywords).length && s.keywords.length) patch.keywords = Object.fromEntries(s.keywords.slice(0, 25));
  if (!d.industries.length && s.industries.length) {
    // The AI profile's industries were asked for; found offline, only the ones the resume keeps coming back to.
    const offline = Object.keys(s.industryCounts).length > 0;
    const picks = offline ? s.industries.filter((id) => (s.industryCounts[id] ?? 0) >= PRESELECT_MENTIONS).slice(0, PRESELECT_MAX) : s.industries.slice(0, 4);
    if (picks.length) patch.industries = picks;
  }
  if (!d.pastEmployers.length && s.pastEmployers.length) patch.pastEmployers = s.pastEmployers.slice(0, 10);
  return patch;
}
