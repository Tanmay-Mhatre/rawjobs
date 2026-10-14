import { employmentType } from "../catalog/employment";
import type { NormalizedJob, Salary } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, countryName, isoDate, joinParts } from "./parse";
import type { HttpError } from "../http";
import { jobId, salaryPeriod, type Connector } from "./types";

/**
 * JobScore, a US hiring system: careers pages at careers.jobscore.com/careers/{slug}. Its public
 * feed, careers.jobscore.com/jobs/{slug}/feed.json, lists every published job with place, remote
 * policy, type, salary and description in one request (robots.txt closes only /apply_flow/).
 */
export type JobScoreJob = {
  id: string;
  title: string;
  department?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  remote?: string;
  job_type?: string;
  opened_date?: string;
  detail_url?: string;
  description?: string;
  public_salary_minimum?: number | null;
  public_salary_maximum?: number | null;
  public_compensation_interval?: string | null;
  currency_code?: string | null;
};

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const HOSTS = /^(careers|widgets)\.jobscore\.com$/i;

export const jobscore: Connector<JobScoreJob> = {
  ats: "jobscore",

  detect(url) {
    if (!HOSTS.test(url.hostname)) return null;
    const [kind, slug] = url.pathname.split("/").filter(Boolean);
    return (kind === "careers" || kind === "jobs") && slug && SLUG.test(slug) ? { ats: "jobscore", slug: slug.toLowerCase() } : null;
  },

  async fetch(ref, { http }) {
    if (!SLUG.test(ref.slug)) throw new Error(`JobScore board should be a short name, got "${ref.slug}"`);
    const url = `https://careers.jobscore.com/jobs/${ref.slug.toLowerCase()}/feed.json`;
    if (!(await robotsAllows(http, url))) throw new Error("robots.txt asks us not to read careers.jobscore.com/jobs/");
    let feed: { jobs?: JobScoreJob[] };
    try {
      feed = await http.getJson(url);
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("JobScore", ref.slug, "(no careers page)");
      throw err;
    }
    if (!Array.isArray(feed.jobs)) throw new Error("unexpected JobScore response: no jobs array");
    return feed.jobs;
  },

  normalize(raw, ref): NormalizedJob {
    const country = countryName(raw.country);
    const location = raw.city || raw.state ? joinParts(raw.city, raw.state, country) : joinParts(raw.location, country);
    // Salaries are in cents.
    const min = raw.public_salary_minimum ? raw.public_salary_minimum / 100 : undefined;
    const max = raw.public_salary_maximum ? raw.public_salary_maximum / 100 : undefined;
    const period = salaryPeriod(raw.public_compensation_interval);
    const salary: Salary | undefined =
      min || max ? { ...(min ? { min } : {}), ...(max ? { max } : {}), ...(raw.currency_code ? { currency: raw.currency_code } : {}), ...(period ? { period } : {}) } : undefined;
    const remote = (raw.remote ?? "").toLowerCase();
    return {
      id: jobId("jobscore", ref.slug, raw.id),
      ats: "jobscore",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country,
      workplace: remote.startsWith("yes") ? "remote" : /hybrid|partial|some of the time/.test(remote) ? "hybrid" : remote.startsWith("no") ? "onsite" : inferWorkplace(`${location} ${raw.title}`),
      department: raw.department || undefined,
      ...(salary ? { salary } : {}),
      postedAt: isoDate(raw.opened_date),
      url: raw.detail_url?.replace(/\?.*$/, "") || `https://careers.jobscore.com/careers/${ref.slug}/jobs/${raw.id}`,
      employmentType: employmentType(raw.job_type),
      description: htmlToText(raw.description ?? ""),
    };
  },
};
