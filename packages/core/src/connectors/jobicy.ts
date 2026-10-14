import { employmentType } from "../catalog/employment";
import type { NormalizedJob, Salary } from "../schema";
import { decodeEntities, htmlToText } from "../text";
import { jobId, type Connector } from "./types";

/**
 * Jobicy's public remote-jobs API (https://jobi.cy/apidocs). Its terms: credit Jobicy with a
 * direct link to the source and send every application to the original job URL (each job's url
 * here is its Jobicy page, and the board is labelled Jobicy). Slug: a search tag
 * (jobicy.com/?search_keywords=…) or "all" for the newest 100 jobs.
 */
export type JobicyJob = {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
};

const PERIOD: Record<string, string> = { yearly: "year", annual: "year", monthly: "month", weekly: "week", hourly: "hour", daily: "day" };

export const jobicy: Connector<JobicyJob> = {
  ats: "jobicy",
  label: "Jobicy",
  // A few times a day is plenty for a remote-jobs feed.
  minIntervalHours: 6,

  detect(url) {
    if (!/(^|\.)jobicy\.com$/i.test(url.hostname)) return null;
    const q = (url.searchParams.get("search_keywords") ?? url.searchParams.get("tag") ?? "").trim();
    return { ats: "jobicy", slug: q ? q.toLowerCase() : "all" };
  },

  async fetch(ref, { http }) {
    const tag = ref.slug && ref.slug !== "all" ? `&tag=${encodeURIComponent(ref.slug)}` : "";
    const data = await http.getJson<{ jobs?: JobicyJob[] }>(`https://jobicy.com/api/v2/remote-jobs?count=100${tag}`);
    if (!Array.isArray(data.jobs)) throw new Error("unexpected Jobicy response: no jobs array");
    return data.jobs;
  },

  normalize(raw, ref): NormalizedJob {
    const geo = raw.jobGeo?.trim();
    const salary: Salary | undefined =
      raw.salaryMin || raw.salaryMax
        ? {
            ...(raw.salaryMin ? { min: raw.salaryMin } : {}),
            ...(raw.salaryMax ? { max: raw.salaryMax } : {}),
            ...(raw.salaryCurrency ? { currency: raw.salaryCurrency } : {}),
            ...(raw.salaryPeriod && PERIOD[raw.salaryPeriod] ? { period: PERIOD[raw.salaryPeriod] } : {}),
          }
        : undefined;
    return {
      id: jobId("jobicy", ref.slug || "all", raw.id),
      ats: "jobicy",
      company: decodeEntities(raw.companyName).trim(),
      title: decodeEntities(raw.jobTitle).trim(),
      location: geo && !/^anywhere$/i.test(geo) ? `Remote (${geo})` : "Remote",
      workplace: "remote",
      department: raw.jobIndustry?.[0] ? decodeEntities(raw.jobIndustry[0]) : undefined,
      ...(salary ? { salary } : {}),
      postedAt: raw.pubDate ? new Date(raw.pubDate).toISOString() : undefined,
      url: raw.url,
      employmentType: employmentType(raw.jobType),
      description: htmlToText(raw.jobDescription ?? ""),
    };
  },
};
