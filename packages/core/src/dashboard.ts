import { citiesIn, countriesIn } from "./catalog/places";
import { seniorityOf } from "./catalog/seniority";
import { TITLE_HEADS } from "./catalog/titles";
import { displayName } from "./display-name";
import type { DashboardJob, Job, JOB_BOARDS } from "./schema";

/**
 * The dashboard's view of a job: no description (that's in descriptions.json), plus countries,
 * seniority and a duplicate group. Pure, so the browser can convert an older jobs.json too.
 */
export function toDashboardJob(job: Job): DashboardJob {
  const { description, missedRuns: _missed, ...rest } = job;
  return {
    ...rest,
    countries: countriesIn(job.location, job.country),
    cities: citiesIn(job.location),
    seniority: seniorityOf(job.title),
    group: groupKey(job.company, job.title),
    hasDescription: !!description,
    ...(description ? { descriptionLength: description.trim().length } : {}),
  };
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
  return countriesIn(piece).length > 0 || citiesIn(piece).length > 0;
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
    const kept = pieces.length > 1 ? pieces.filter((p) => !placeOnly(p)) : pieces;
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
 * Job boards (JOB_BOARDS in schema.ts, kept here so the browser doesn't load the config schema): they
 * repost a company's jobs, so when a role is on both, the company's own posting is the one we show.
 */
const BOARD_SOURCES: ReadonlySet<string> = new Set(["hackernews", "remotive", "arbeitnow", "remoteok", "himalayas", "jobicy", "weworkremotely"] satisfies (typeof JOB_BOARDS)[number][]);

/** A posting copied by a job board, not from the company's own hiring system. */
export const fromJobBoard = (job: Pick<Job, "ats">): boolean => BOARD_SOURCES.has(job.ats);
