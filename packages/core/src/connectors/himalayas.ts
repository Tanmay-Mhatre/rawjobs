import { employmentType } from "../catalog/employment";
import type { NormalizedJob, Salary } from "../schema";
import { htmlToText } from "../text";
import { jobId, type Connector } from "./types";

/**
 * Himalayas' public jobs API (https://himalayas.app/api): remote jobs. Its terms: link back to
 * the job's Himalayas page and name Himalayas as the source (both on every job here), don't
 * submit the jobs to other sites (RawJobs never shares board jobs), and poll no more than daily
 * (its data refreshes every 24 h). Slug: a search phrase (himalayas.app/jobs?q=…) or "all" for
 * the newest jobs. The API returns 20 jobs a request at most, so a fetch reads the newest pages.
 */
export type HimalayasJob = {
  title: string;
  companyName: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  currency?: string | null;
  locationRestrictions?: string[];
  parentCategories?: string[];
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
  description?: string;
};

const BASE = "https://himalayas.app/jobs/api";
/** Pages read per fetch: "all" pages 20 jobs, a search 5. */
const PAGES = 10;
const PERIOD: Record<string, string> = { annual: "year", yearly: "year", monthly: "month", weekly: "week", hourly: "hour", daily: "day" };

export const himalayas: Connector<HimalayasJob> = {
  ats: "himalayas",
  label: "Himalayas",
  // Its data refreshes once a day.
  minIntervalHours: 24,

  detect(url) {
    if (!/(^|\.)himalayas\.app$/i.test(url.hostname)) return null;
    const q = url.searchParams.get("q")?.trim();
    return { ats: "himalayas", slug: q ? q.toLowerCase() : "all" };
  },

  async fetch(ref, { http }) {
    const out: HimalayasJob[] = [];
    if (!ref.slug || ref.slug === "all") {
      let cursor: string | undefined;
      for (let i = 0; i < PAGES; i++) {
        const page = await http.getJson<{ jobs?: HimalayasJob[]; nextCursor?: string }>(`${BASE}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (!Array.isArray(page.jobs)) throw new Error("unexpected Himalayas response: no jobs array");
        out.push(...page.jobs);
        cursor = page.nextCursor;
        if (!cursor || !page.jobs.length) break;
      }
      return out;
    }
    for (let p = 1; p <= PAGES; p++) {
      const page = await http.getJson<{ jobs?: HimalayasJob[] }>(`${BASE}/search?q=${encodeURIComponent(ref.slug)}&sort=recent&page=${p}`);
      if (!Array.isArray(page.jobs)) throw new Error("unexpected Himalayas response: no jobs array");
      out.push(...page.jobs);
      if (!page.jobs.length) break;
    }
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const where = (raw.locationRestrictions ?? []).join(", ");
    const url = raw.applicationLink || raw.guid || "https://himalayas.app/jobs";
    const salary: Salary | undefined =
      raw.minSalary || raw.maxSalary
        ? {
            ...(raw.minSalary ? { min: raw.minSalary } : {}),
            ...(raw.maxSalary ? { max: raw.maxSalary } : {}),
            ...(raw.currency ? { currency: raw.currency } : {}),
            ...(raw.salaryPeriod && PERIOD[raw.salaryPeriod] ? { period: PERIOD[raw.salaryPeriod] } : {}),
          }
        : undefined;
    return {
      id: jobId("himalayas", ref.slug || "all", url.replace(/^https:\/\/himalayas\.app\//, "")),
      ats: "himalayas",
      company: raw.companyName.trim(),
      title: raw.title.trim(),
      location: where ? `Remote (${where})` : "Remote",
      country: raw.locationRestrictions?.length === 1 ? raw.locationRestrictions[0] : undefined,
      workplace: "remote",
      department: raw.parentCategories?.[0],
      ...(salary ? { salary } : {}),
      postedAt: raw.pubDate ? new Date(raw.pubDate * 1000).toISOString() : undefined,
      url,
      employmentType: employmentType(raw.employmentType),
      description: htmlToText(raw.description ?? ""),
    };
  },
};
