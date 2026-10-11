import { placeOwner } from "./catalog/places";
import { countryOfLocation, extractEligibility, payOf, type Pay, type Period } from "./posting";
import type { NormalizedJob, Profile } from "./schema";
import { matchesTitle, termRegex } from "./text";

/**
 * Dealbreakers: things a posting says that rule it out for you, whatever else fits. Each one is a
 * plain sentence in `why.dealbreakers`; scoreJob halves the score and keeps it under your threshold,
 * so the job stays on your Radar (with the reason) but never counts as strong or alerts as one.
 * Only what the posting states counts: unknown pay or sponsorship is never a dealbreaker.
 */

type Checkable = Pick<NormalizedJob, "title" | "location" | "workplace" | "description" | "salary">;

/** A posted top of range this close under your floor is a stretch, not a dealbreaker (eval rubric: within 5%). */
export const SALARY_SLACK = 0.05;
/** An avoided topic counts from the description when it's this many mentions anywhere... */
const AVOID_MENTIONS = 3;
/** ...or two, the first within this many characters (the opening that says what the role is). */
const AVOID_OPENING = 600;

/** EU and EEA countries (and Switzerland): where "eu" in your work authorisation lets you work. */
const EU = [
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic", "denmark", "estonia", "finland", "france", "germany", "greece",
  "hungary", "ireland", "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal", "romania", "slovakia",
  "slovenia", "spain", "sweden", "iceland", "liechtenstein", "norway", "switzerland",
];
const EU_TERMS = new Set(["eu", "european union", "eea"]);

/**
 * Countries (lower case) named by place terms: countries, their cities and aliases. Regions name none,
 * except that with `eu` "eu" (or "eea") is every EU/EEA country: for work authorisation, not for where you live.
 */
export function countriesOfTerms(terms: readonly string[], o: { eu?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (o.eu && EU_TERMS.has(t)) for (const c of EU) out.add(c);
    const owner = placeOwner(t);
    if (owner?.startsWith("country:")) out.add(owner.slice(8));
  }
  return out;
}

const PER_YEAR: Record<Period, number> = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };
/** "netherlands" -> "the Netherlands", "germany" -> "Germany". */
const title = (country: string) =>
  (/^(?:united |netherlands$|philippines$|czech republic$|bahamas$|gambia$|maldives$)/.test(country) ? "the " : "") +
  country.replace(/(^|\s)\p{L}/gu, (ch) => ch.toUpperCase());
/** 18000 -> "18k", 6500 -> "6.5k", 950 -> "950". */
const short = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${Math.round(n)}`);

/**
 * The posting's top of range against your floor, in your floor's period. A posting with no period
 * is read in yours, unless that makes it implausibly low (a monthly figure against a yearly floor).
 */
export function salaryBreaker(pay: Pay | undefined, floor: NonNullable<Profile["salary_floor"]>): string | undefined {
  const top = pay?.max ?? pay?.min;
  if (!pay || !top || pay.currency !== floor.currency.toUpperCase()) return undefined;
  const period = pay.period ?? floor.period;
  const inFloorPeriod = (top * PER_YEAR[period]) / PER_YEAR[floor.period];
  if (!pay.period && inFloorPeriod < floor.amount * 0.4) return undefined;
  if (inFloorPeriod >= floor.amount * (1 - SALARY_SLACK)) return undefined;
  const per = floor.period === "month" ? " a month" : " a year";
  return `Pay below your floor: up to ${pay.currency} ${short(inFloorPeriod)} vs your ${short(floor.amount)}${per}`;
}

/** Does the role itself look like one you avoid? In the title, or said again and again (or early and again) in the description. */
export function avoidHit(job: Pick<Checkable, "title" | "description">, phrase: string): boolean {
  if (matchesTitle(job.title, [phrase])) return true;
  const d = job.description ?? "";
  if (!d) return false;
  const at = [...d.matchAll(new RegExp(termRegex(phrase).source, "giu"))].map((m) => m.index ?? 0);
  return at.length >= AVOID_MENTIONS || (at.length >= 2 && at[0]! < AVOID_OPENING);
}

/** Your dealbreakers this job breaks, as plain sentences. Empty when none (or when your profile sets none it can check). */
export function dealbreakers(job: Checkable, profile: Profile): string[] {
  const out: string[] = [];
  if (profile.salary_floor) {
    const s = salaryBreaker(payOf(job), profile.salary_floor);
    if (s) out.push(s);
  }

  const e = extractEligibility(job.description);
  const located = countryOfLocation(job.location);
  // Where you live: the countries your places and remote regions name.
  const home = countriesOfTerms([...profile.locations.include, ...profile.locations.remote_ok]);
  const authorised = countriesOfTerms(profile.work_authorization ?? [], { eu: true });
  if (profile.work_authorization?.length && e.sponsorship === "no") {
    const country = e.authorisedIn ?? located;
    if (country && !authorised.has(country)) out.push(`No visa sponsorship, and you need one for ${title(country)}`);
  }
  if (e.residentIn && home.size && !home.has(e.residentIn)) out.push(`Only for people already living in ${title(e.residentIn)}`);
  if (e.relocation === "no" && home.size && (e.onsiteIn || job.workplace === "onsite")) {
    const country = e.onsiteIn ? countriesOfTerms([e.onsiteIn]).values().next().value : located;
    if (country && !home.has(country) && country !== e.residentIn) out.push(`On-site in ${e.onsiteIn ?? title(country)}, with no relocation`);
  }

  for (const phrase of profile.avoid ?? []) {
    if (avoidHit(job, phrase)) out.push(`About ${phrase}, which you avoid`);
  }
  return out;
}
