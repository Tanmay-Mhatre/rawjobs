import type { NormalizedJob, Salary } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { countryName, joinParts } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Keka, HR software big in India: careers sites at {account}.keka.com/careers. The page loads its
 * portal from /ats/documents/{org id}/…, and that id opens the public job list,
 * /careers/api/embedjobs/default/active/{org id}: every open job with places, department,
 * salary range, publish date and description, in one request. Kept as slug = account, site =
 * the org id (read from the careers page when a list doesn't give it).
 */
export type KekaJob = {
  id: number;
  title: string;
  description?: string;
  departmentName?: string;
  jobLocations?: { city?: string; state?: string; countryCode?: string; countryName?: string }[];
  salaryRange?: { minimum?: number; maximum?: number; currency?: string } | null;
  publishedOn?: string;
};

const ACCOUNT = /^[a-z0-9][a-z0-9-]*$/i;
const ORG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const base = (slug: string) => {
  if (!ACCOUNT.test(slug)) throw new Error(`Keka account should be a subdomain name, got "${slug}"`);
  return `https://${slug.toLowerCase()}.keka.com`;
};

async function orgId(ref: { slug: string; site?: string }, http: Ctx["http"]): Promise<string> {
  if (ref.site && ORG.test(ref.site)) return ref.site.toLowerCase();
  const html = await http.getText(`${base(ref.slug)}/careers`);
  const id = html.match(/\/ats\/documents\/([0-9a-f-]{36})\//i)?.[1];
  if (!id) throw new Error(`Keka careers site "${ref.slug}" not found`);
  return id.toLowerCase();
}

export const keka: Connector<KekaJob> = {
  ats: "keka",

  detect(url) {
    const sub = url.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.keka\.com$/)?.[1];
    return sub && !["www", "app", "api", "help", "cdn"].includes(sub) ? { ats: "keka", slug: sub } : null;
  },

  async fetch(ref, { http }) {
    const id = await orgId(ref, http);
    const jobs = await http.getJson<KekaJob[]>(`${base(ref.slug)}/careers/api/embedjobs/default/active/${id}`);
    if (!Array.isArray(jobs)) throw new Error("unexpected Keka response: no job list");
    return jobs;
  },

  normalize(raw, ref): NormalizedJob {
    const places = [...new Set((raw.jobLocations ?? []).map((l) => joinParts(l.city, l.countryName || countryName(l.countryCode))))].filter(Boolean);
    const location = places.join("; ");
    const s = raw.salaryRange;
    const salary: Salary | undefined =
      s && (s.minimum || s.maximum) ? { ...(s.minimum ? { min: s.minimum } : {}), ...(s.maximum ? { max: s.maximum } : {}), ...(s.currency ? { currency: s.currency } : {}) } : undefined;
    return {
      id: jobId("keka", ref.slug, String(raw.id)),
      ats: "keka",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: raw.jobLocations?.[0]?.countryName || countryName(raw.jobLocations?.[0]?.countryCode),
      workplace: inferWorkplace(`${location} ${raw.title}`),
      department: raw.departmentName || undefined,
      ...(salary ? { salary } : {}),
      postedAt: raw.publishedOn ? new Date(raw.publishedOn).toISOString() : undefined,
      url: `${base(ref.slug)}/careers/jobdetails/${raw.id}`,
      description: htmlToText(raw.description ?? ""),
    };
  },
};
