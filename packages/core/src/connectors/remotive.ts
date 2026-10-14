import { employmentType } from "../catalog/employment";
import type { NormalizedJob } from "../schema";
import { htmlToText } from "../text";
import { isoDate } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Remotive's public API (https://github.com/remotive-com/remote-jobs-api): remote jobs, listed 24 h
 * after they're posted on remotive.com. Its terms: link back to Remotive (each job's url is its
 * Remotive page), don't pass the jobs on to other job boards, and keep requests to a few a day.
 * Slug: a category ("software-dev") or "all".
 */
export type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

export const remotive: Connector<RemotiveJob> = {
  ats: "remotive",
  label: "Remotive",
  // Remotive asks for no more than about four requests a day.
  minIntervalHours: 6,

  detect(url) {
    if (!/(^|\.)remotive\.(com|io)$/i.test(url.hostname)) return null;
    const category = url.pathname.match(/^\/remote-jobs\/([a-z0-9-]+)/i)?.[1];
    return { ats: "remotive", slug: category ?? "all" };
  },

  async fetch(ref, { http }) {
    // Without a limit the API answers with only the newest ~20.
    const q = ref.slug && ref.slug !== "all" ? `&category=${encodeURIComponent(ref.slug)}` : "";
    const data = await http.getJson<{ jobs?: RemotiveJob[] }>(`https://remotive.com/api/remote-jobs?limit=500${q}`);
    if (!Array.isArray(data.jobs)) throw new Error("unexpected Remotive response: no jobs array");
    return data.jobs;
  },

  normalize(raw, ref): NormalizedJob {
    const where = raw.candidate_required_location?.trim();
    return {
      id: jobId("remotive", ref.slug, raw.id),
      ats: "remotive",
      company: raw.company_name.trim(),
      title: raw.title.trim(),
      location: where ? `Remote (${where})` : "Remote",
      workplace: "remote",
      department: raw.category,
      postedAt: isoDate(raw.publication_date),
      url: raw.url,
      employmentType: employmentType(raw.job_type),
      description: htmlToText(raw.description),
    };
  },
};
