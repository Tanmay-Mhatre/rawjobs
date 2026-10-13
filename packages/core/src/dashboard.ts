import { citiesIn, countriesIn } from "./catalog/places";
import { seniorityOf } from "./catalog/seniority";
import { TITLE_HEADS } from "./catalog/titles";
import type { DashboardJob, Job } from "./schema";

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
 * Postings of one role: the same company and title, with the place left out, so one role posted per
 * city ("… - Manchester, United Kingdom", "… - Oxford, United Kingdom", "Dubai - …") is one row.
 */
export function groupKey(company: string, title: string): string {
  let key = groupCache.get(title);
  if (key === undefined) {
    const pieces = title
      .split(PIECES)
      .map((s) => s.trim())
      .filter(Boolean);
    const kept = pieces.length > 1 ? pieces.filter((p) => !placeOnly(p)) : pieces;
    key = (kept.length ? kept : pieces).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
    if (groupCache.size > 20_000) groupCache.clear();
    groupCache.set(title, key);
  }
  return `${company}|${key}`;
}
