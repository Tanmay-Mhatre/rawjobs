import type { NormalizedJob, Salary, Workplace } from "../schema";
import { htmlToText } from "../text";
import { urlOf } from "./parse";
import { firstPathSegment, jobId, salaryPeriod, type Connector } from "./types";

/** https://developers.ashbyhq.com/docs/public-job-posting-api */
export type AshbyJob = {
  id: string;
  title: string;
  department?: string;
  team?: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: "OnSite" | "Remote" | "Hybrid" | string | null;
  address?: { postalAddress?: { addressCountry?: string; addressLocality?: string } };
  jobUrl: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensation?: {
    summaryComponents?: {
      compensationType: string;
      interval?: string;
      currencyCode?: string | null;
      minValue?: number | null;
      maxValue?: number | null;
    }[];
  };
};

const WORKPLACE: Record<string, Workplace> = { OnSite: "onsite", Remote: "remote", Hybrid: "hybrid" };

function salaryOf(job: AshbyJob): Salary | undefined {
  const c = job.compensation?.summaryComponents?.find((x) => x.compensationType === "Salary");
  if (!c || (c.minValue == null && c.maxValue == null)) return undefined;
  return {
    min: c.minValue ?? undefined,
    max: c.maxValue ?? undefined,
    currency: c.currencyCode ?? undefined,
    period: salaryPeriod(c.interval),
  };
}

export const ashby: Connector<AshbyJob> = {
  ats: "ashby",

  detect(url) {
    const host = url.hostname.toLowerCase();
    // API URL: api.ashbyhq.com/posting-api/job-board/acme
    const api = host === "api.ashbyhq.com" ? url.pathname.match(/^\/posting-api\/job-board\/([^/?]+)/) : null;
    if (api?.[1]) return { ats: "ashby", slug: decodeURIComponent(api[1]) };
    if (host !== "jobs.ashbyhq.com") return null;
    const slug = firstPathSegment(url);
    // jobs.ashbyhq.com/api/... is the board's own API, not a company.
    return slug && slug !== "api" ? { ats: "ashby", slug } : null;
  },

  async fetch(ref, { http }) {
    const data = await http.getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.slug)}?includeCompensation=true`);
    if (!Array.isArray(data.jobs)) throw new Error("unexpected Ashby response: no jobs array");
    // Unlisted jobs are reachable only by direct link; the company chose not to advertise them.
    return data.jobs.filter((j) => j.isListed !== false);
  },

  /**
   * Ashby has no public address per posting, so the board's list (the scan's own request, often a
   * saved 304) is read: a job missing from a list that loaded is gone. Links are jobs.ashbyhq.com/acme/{id}.
   */
  async isOpen(job, { http }) {
    const url = urlOf(job.url);
    const board = url ? ashby.detect(url) : null;
    const id = board ? url?.pathname.split("/").filter(Boolean)[1] : undefined;
    if (!board || !id || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const data = await http.getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`).catch(() => undefined);
    // An empty list could be a hiccup as easily as a closed board: only a list with jobs in it can rule one out.
    if (!data?.jobs?.length) return undefined;
    return data.jobs.some((j) => j.id === id);
  },

  normalize(raw, ref): NormalizedJob {
    const location = [raw.location, ...(raw.secondaryLocations ?? []).map((l) => l.location)].filter((l): l is string => !!l?.trim()).join("; ");
    return {
      id: jobId("ashby", ref.slug, raw.id),
      ats: "ashby",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: raw.address?.postalAddress?.addressCountry,
      workplace: WORKPLACE[raw.workplaceType ?? ""] ?? (raw.isRemote ? "remote" : "unknown"),
      department: raw.department ?? raw.team,
      salary: salaryOf(raw),
      postedAt: raw.publishedAt,
      url: raw.jobUrl,
      description: raw.descriptionPlain?.trim() || htmlToText(raw.descriptionHtml),
    };
  },
};
