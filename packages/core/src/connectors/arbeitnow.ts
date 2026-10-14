import { employmentType } from "../catalog/employment";
import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { jobId, type Connector } from "./types";

/**
 * Arbeitnow's free job board API (https://www.arbeitnow.com/api/job-board-api): mostly Germany and
 * Europe, many with English-speaking teams or visa sponsorship. Keyless; each job's url is its
 * Arbeitnow page. Read a few pages, newest first.
 */
export type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  /** Unix seconds. */
  created_at?: number;
};

const PAGES = 3;

export const arbeitnow: Connector<ArbeitnowJob> = {
  ats: "arbeitnow",
  label: "Arbeitnow",
  minIntervalHours: 6,

  detect(url) {
    return /(^|\.)arbeitnow\.com$/i.test(url.hostname) ? { ats: "arbeitnow", slug: "all" } : null;
  },

  async fetch(_ref, { http }) {
    const out: ArbeitnowJob[] = [];
    for (let page = 1; page <= PAGES; page++) {
      const data = await http.getJson<{ data?: ArbeitnowJob[]; links?: { next?: string | null } }>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      if (!Array.isArray(data.data)) throw new Error("unexpected Arbeitnow response: no data array");
      out.push(...data.data);
      if (!data.links?.next) break;
    }
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const location = [raw.location?.trim(), raw.remote ? "Remote" : undefined].filter(Boolean).join("; ");
    return {
      id: jobId("arbeitnow", ref.slug, raw.slug),
      ats: "arbeitnow",
      company: raw.company_name.trim(),
      title: raw.title.trim(),
      location,
      workplace: raw.remote ? "remote" : inferWorkplace(location),
      department: raw.tags?.[0],
      postedAt: raw.created_at ? new Date(raw.created_at * 1000).toISOString() : undefined,
      url: raw.url,
      employmentType: employmentType(raw.job_types),
      description: htmlToText(raw.description),
    };
  },
};
