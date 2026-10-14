import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, joinParts } from "./parse";
import { jobId, salaryPeriod, type Connector } from "./types";

/** {company}.careers.hibob.com/api/job-ad, as the careers page loads it (descriptions included). */
export type HibobJob = {
  id: string;
  title: string;
  department?: string | null;
  site?: string | null;
  country?: string | null;
  description?: string | null;
  requirements?: string | null;
  responsibilities?: string | null;
  benefits?: string | null;
  publishedAt?: string;
  workspaceTypeId?: string | null;
  payTransparencyMinSalary?: number | null;
  payTransparencyMaxSalary?: number | null;
  payTransparencySalaryCurrency?: string | null;
  payTransparencySalaryPayPeriod?: string | null;
};

const WORKPLACE: Record<string, Workplace> = { on_site: "onsite", hybrid: "hybrid", remote: "remote" };

export const hibob: Connector<HibobJob> = {
  ats: "hibob",
  detect: detectAs("hibob"),

  async fetch(ref, { http }) {
    // The careers page names the company in a header; without it the API answers 401.
    const { body } = await http.requestBody(`https://${ref.slug}.careers.hibob.com/api/job-ad`, { headers: { accept: "application/json", companyidentifier: ref.slug } });
    const data = JSON.parse(body) as { jobAdDetails?: HibobJob[] };
    if (!Array.isArray(data.jobAdDetails)) throw new Error("unexpected HiBob response: no jobAdDetails array");
    return data.jobAdDetails;
  },

  normalize(raw, ref): NormalizedJob {
    const workplace = WORKPLACE[raw.workspaceTypeId ?? ""];
    const location = joinParts(raw.site, raw.country, workplace === "remote" ? "Remote" : undefined);
    const min = raw.payTransparencyMinSalary ?? undefined;
    const max = raw.payTransparencyMaxSalary ?? undefined;
    return {
      id: jobId("hibob", ref.slug, raw.id),
      ats: "hibob",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: raw.country ?? undefined,
      workplace: workplace ?? inferWorkplace(location),
      department: raw.department ?? undefined,
      salary: min || max ? { min, max, currency: raw.payTransparencySalaryCurrency ?? undefined, period: salaryPeriod(raw.payTransparencySalaryPayPeriod) } : undefined,
      postedAt: isoDate(raw.publishedAt),
      url: `https://${ref.slug}.careers.hibob.com/jobs/${raw.id}`,
      description: [raw.description, raw.responsibilities, raw.requirements, raw.benefits].map(htmlToText).filter(Boolean).join("\n\n"),
    };
  },
};
