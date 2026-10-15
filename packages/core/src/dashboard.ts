import { employmentTypeOfTitle } from "./catalog/employment";
import { citiesIn, countriesIn } from "./catalog/places";
import { seniorityOf } from "./catalog/seniority";
import { TITLE_HEADS } from "./catalog/titles";
import { displayName } from "./display-name";
import { extractEligibility, extractPay, regionOnly } from "./posting";
import type { DashboardJob, Job, JOB_BOARDS, JobEligibility } from "./schema";

/**
 * The dashboard's view of a job: no description (that's in descriptions.json), plus countries,
 * seniority and a duplicate group. Pure, so the browser can convert an older jobs.json too.
 */
export function toDashboardJob(job: Job): DashboardJob {
  const { description, missedRuns: _missed, ...rest } = job;
  // Older saves and hiring systems that don't say: from the title's own words ("Intern", "(Contract)").
  const employmentType = job.employmentType ?? employmentTypeOfTitle(job.title);
  // The hiring system's pay field wins; else pay the description states ("AED 28,000 - 32,000 per month").
  const statedPay = job.salary?.currency && (job.salary.min || job.salary.max);
  const pay = statedPay ? undefined : extractPay(description);
  const eligibility = eligibilityOf(job, description);
  return {
    ...rest,
    ...(pay ? { salary: pay, salaryFrom: "description" as const } : {}),
    ...(eligibility ? { eligibility } : {}),
    countries: countriesIn(job.location, job.country),
    cities: citiesIn(job.location),
    seniority: seniorityOf(job.title),
    ...(employmentType ? { employmentType } : {}),
    group: groupKey(job.company, job.title),
    hasDescription: !!description,
    ...(description ? { descriptionLength: description.trim().length } : {}),
  };
}

/** What the posting says about who can take the job; undefined when it says nothing. */
export function eligibilityOf(job: Pick<Job, "title" | "location">, description: string | undefined): JobEligibility | undefined {
  const e = extractEligibility(description);
  const region = regionOnly(job.title) ?? regionOnly(job.location);
  const out: JobEligibility = {
    ...(e.sponsorship !== "unknown" ? { sponsorship: e.sponsorship } : {}),
    ...(e.relocation !== "unknown" ? { relocation: e.relocation } : {}),
    ...(e.authorisedIn ? { authorisedIn: e.authorisedIn } : {}),
    ...(e.residentIn ? { residentIn: e.residentIn } : {}),
    ...(region ? { regionOnly: region } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** A title's pieces: "Team Lead, Android Core Product - Manchester, United Kingdom" -> two. */
const PIECES = /\s+[-–—|]\s+|\s*[()[\]]\s*/;
const REMOTE_PIECE = /^(?:fully )?remote\b/i;
const groupCache = new Map<string, string>();

/** A piece that only names where the job is ("Manchester, United Kingdom", "Remote", "Dubai"). */
function placeOnly(piece: string): boolean {
  if (REMOTE_PIECE.test(piece)) return true;
  const words = piece
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (!words.length || words.length > 5 || words.some((w) => TITLE_HEADS.has(w))) return false;
  // citiesIn() also returns words it doesn't know ("Payments", "Growth"); a known city comes back with
  // its country ("Manchester, United Kingdom"). Counting unknown words as places merged different roles.
  return countriesIn(piece).length > 0 || citiesIn(piece).some((city) => city.includes(", "));
}

/**
 * Plain lower-case words: accents off ("Zürich" is "zurich"), "&" is "and", other punctuation is a
 * space. Languages that say what they are in symbols keep it: "C++", "C#" and ".NET" aren't all "c".
 */
function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\.net\b/g, " dotnet ")
    .replace(/(\p{L})\+\+/gu, "$1pp")
    .replace(/(\p{L})#/gu, "$1sharp")
    .replace(/&/g, " and ")
    .replace(/(\p{L})\.(?=\p{L}\b)/gu, "$1")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Legal forms and "company" words at the end of a name, as whole words: "Acme Inc.", "ACME GmbH",
 * "Acme Pty Ltd", "The Acme Company". Words that are often the brand's own ("Group", "Holdings",
 * "Labs", "Technologies") stay, so "Bain" and "Bain Group" are two companies.
 */
const COMPANY_SUFFIXES = new Set("inc incorporated llc llp ltd limited plc gmbh ag sa sas bv nv ab oy as aps srl spa pty pvt pte co corp corporation company".split(" "));
const companyCache = new Map<string, string>();

/**
 * The company part of a role's key. Job boards and the company's own board spell one company
 * differently ("Acme, Inc.", "ACME GmbH", "The Acme Company"), so it's the name as people say it
 * (displayName) in plain words, without legal forms or a leading "the". Never down to nothing:
 * at least one word stays, so "The Company" isn't "Company". Spaces go too, so "Open AI" is "OpenAI".
 */
function companyKey(company: string): string {
  let key = companyCache.get(company);
  if (key === undefined) {
    const w = words(displayName(company));
    if (w.length > 1 && w[0] === "the" && !COMPANY_SUFFIXES.has(w[1]!)) w.shift();
    // "Procter & Gamble Co." loses "Co." and then the "and" it leaves hanging.
    while (w.length > 1 && (COMPANY_SUFFIXES.has(w.at(-1)!) || w.at(-1) === "and")) w.pop();
    key = w.join("") || company.trim().toLowerCase();
    if (companyCache.size > 20_000) companyCache.clear();
    companyCache.set(company, key);
  }
  return key;
}

/** The company part of a role's key, for matching a job board's company name to a company's own board. */
export const companyNameKey = companyKey;

/** A title piece that only says who may apply ("m/w/d", "f/m/x", "all genders", "h/f"): not part of the role. */
const GENDER_PIECE = /^(?:[mwfdhxi*](?:\s*[/|,]\s*[mwfdhxi*]){1,3}|all genders?|gn|gender neutral)$/i;
/** A title piece that's only a requisition id ("R12345", "Req #1234", "JR-0042", "123456"). */
const REQ_PIECE = /^(?:(?:req(?:uisition)?|job)(?:\s*(?:id|no\.?|number))?\s*[:#]?\s*)?[a-z]{0,3}[-_]?\d{4,}$/i;

/** Short forms in titles, as whole words: "Sr." is "Senior", but "Engineering" and "Srebrenica" stay. */
const TITLE_SHORT_FORMS: ReadonlyMap<string, string> = new Map([
  ["sr", "senior"],
  ["snr", "senior"],
  ["jr", "junior"],
  ["jnr", "junior"],
  ["mgr", "manager"],
  ["eng", "engineer"],
  ["engr", "engineer"],
]);

/**
 * The title part of a role's key: the title with the place left out, in plain words, short forms
 * written out. "Sr. Software Engineer - Remote" and "Senior Software Engineer" are one role; "Engineer
 * II" and "Engineer III" stay two.
 */
function titleKey(title: string): string {
  let key = groupCache.get(title);
  if (key === undefined) {
    const pieces = title
      .split(PIECES)
      .map((s) => s.trim())
      .filter(Boolean);
    // Places, gender tags and requisition ids say nothing about the role: "Engineer (m/w/d) - R1234 - Berlin" is "engineer".
    const kept = pieces.length > 1 ? pieces.filter((p) => !placeOnly(p) && !GENDER_PIECE.test(p) && !REQ_PIECE.test(p)) : pieces;
    const w = words((kept.length ? kept : pieces).join(" ")).map((t) => TITLE_SHORT_FORMS.get(t) ?? t);
    key = w.join(" ") || title.toLowerCase().replace(/\s+/g, " ").trim();
    if (groupCache.size > 20_000) groupCache.clear();
    groupCache.set(title, key);
  }
  return key;
}

/**
 * Postings of one role: the same company and title, with the place left out, so one role posted per
 * city ("… - Manchester, United Kingdom", "… - Oxford, United Kingdom", "Dubai - …") is one row. The
 * same role from a job board and from the company's own board is one row too, though they spell it
 * differently ("Acme Inc." / "Sr. Software Engineer", "ACME" / "Senior Software Engineer").
 */
export function groupKey(company: string, title: string): string {
  return `${companyKey(company)}|${titleKey(title)}`;
}

/**
 * The title part of a role's key on its own: two postings at one company are one role when it's equal.
 * No fuzzy matching: "Senior Engineer, Payments" and "Senior Engineer, Platform" stay two.
 */
export const roleKey = (title: string): string => titleKey(title);

/**
 * Job boards (JOB_BOARDS in schema.ts, kept here so the browser doesn't load the config schema): they
 * repost a company's jobs, so when a role is on both, the company's own posting is the one we show.
 */
const BOARD_SOURCES: ReadonlySet<string> = new Set([
  "hackernews",
  "remotive",
  "arbeitnow",
  "remoteok",
  "himalayas",
  "jobicy",
  "weworkremotely",
  "remotefirstjobs",
] satisfies (typeof JOB_BOARDS)[number][]);

/** A posting copied by a job board, not from the company's own hiring system. */
export const fromJobBoard = (job: Pick<Job, "ats">): boolean => BOARD_SOURCES.has(job.ats);
