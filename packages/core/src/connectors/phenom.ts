import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { joinParts } from "./parse";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/**
 * Phenom careers sites, used by large employers on their own domains (careers.dhl.com,
 * careers.adobe.com), keyed by that host. The site's own page calls POST {host}/widgets: a
 * "refineSearch" for the job list (100 a page) and a "jobDetail" for one posting's description.
 */
export type PhenomJob = {
  jobSeqNo: string;
  title: string;
  cityState?: string;
  city?: string;
  country?: string;
  locale?: string;
  postedDate?: string;
  category?: string;
  remote?: boolean | string;
};

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const PAGE = 100;
/** Beyond this we stop paging (DHL alone lists ~10,000). */
const MAX_POSTINGS = 2000;

const base = (slug: string) => {
  if (!HOST.test(slug)) throw new Error(`Phenom careers site should be a host name, got "${slug}"`);
  return `https://${slug.toLowerCase()}`;
};

/** "2026-09-22T05:28:01.442+0000" -> ISO. */
const posted = (s?: string) => (s ? new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString() : undefined);

/** Phenom answers JSON to its own widgets call: how a site on any domain proves it is one. */
export async function isPhenomSite(host: string, http: { postJson<T>(url: string, body: unknown): Promise<T> }): Promise<boolean> {
  const res = await http.postJson<{ refineSearch?: { data?: { jobs?: unknown[] } } }>(`${base(host)}/widgets`, { deviceType: "desktop", ddoKey: "refineSearch", jobs: true, from: 0, size: 1 });
  return Array.isArray(res.refineSearch?.data?.jobs);
}

/** The site's jobs, or its results for `keywords` (what the site's own search box sends), up to `max`. */
async function list(ref: CompanyRef, http: Ctx["http"], keywords: string, max: number) {
  const url = `${base(ref.slug)}/widgets`;
  const out: PhenomJob[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let from = 0; from < max; from += PAGE) {
    const res = await http.postJson<{ refineSearch?: { totalHits?: number; data?: { jobs?: PhenomJob[] } } }>(url, {
      deviceType: "desktop",
      ddoKey: "refineSearch",
      jobs: true,
      from,
      size: PAGE,
      ...(keywords ? { keywords } : {}),
    });
    const jobs = res.refineSearch?.data?.jobs;
    if (!Array.isArray(jobs)) throw new Error(`${ref.slug} is not a Phenom careers site (no job list from its widgets)`);
    total = res.refineSearch?.totalHits ?? 0;
    const fresh = jobs.filter((j) => j.jobSeqNo && !seen.has(j.jobSeqNo));
    for (const j of fresh) seen.add(j.jobSeqNo);
    out.push(...fresh);
    if (jobs.length < PAGE || !fresh.length) break;
  }
  return { out, total };
}

export const phenom: Connector<PhenomJob> = {
  ats: "phenom",
  // Phenom sites live on the companies' own domains: found by Add by link's probe and the lists.
  detect: () => null,

  async fetch(ref, { http, partial }) {
    const { out, total } = await list(ref, http, "", MAX_POSTINGS);
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    return (await list(ref, http, term, SEARCH_MAX_POSTINGS)).out;
  },

  async describe(raw, ref, { http }) {
    const res = await http.postJson<{ jobDetail?: { data?: { job?: { description?: string } } } }>(`${base(ref.slug)}/widgets`, {
      deviceType: "desktop",
      ddoKey: "jobDetail",
      pageName: "job-details",
      jobSeqNo: raw.jobSeqNo,
    });
    return htmlToText(res.jobDetail?.data?.job?.description ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    const remote = raw.remote === true || /^(true|yes|remote)$/i.test(String(raw.remote ?? ""));
    // "9362 - Instrumentation Svcs - Charlotte, North Carolina": keep the place after the last " - ".
    const place = (raw.cityState ?? raw.city ?? "").replace(/^.* - /, "").trim();
    const country = raw.country?.replace(/ of America$/, "");
    const location = joinParts(place, country, remote ? "Remote" : undefined);
    const workplace: Workplace = remote ? "remote" : inferWorkplace(location);
    // Job pages: /{country}/{lang}/job/{seq} when the locale names them, else /job/{seq}.
    const [lang, region] = (raw.locale ?? "").split("_");
    const path = lang && region ? `/${region.toLowerCase()}/${lang.toLowerCase()}/job/${raw.jobSeqNo}` : `/job/${raw.jobSeqNo}`;
    return {
      id: jobId("phenom", ref.slug, raw.jobSeqNo),
      ats: "phenom",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: country || undefined,
      workplace,
      department: raw.category || undefined,
      postedAt: posted(raw.postedDate),
      url: `${base(ref.slug)}${path}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
