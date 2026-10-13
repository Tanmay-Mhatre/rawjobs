import type { NormalizedJob, Salary, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { iso3Country, jobPostingLd, joinParts } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * ApplicantPro career sites, also sold as iSolved Hire: {account}.applicantpro.com or
 * {account}.isolvedhire.com. Kept as slug = account, shard = the domain, site = the site's
 * numeric id (read from the careers page when a list doesn't give it). The page's own call,
 * /core/jobs/{id}, returns every open job (place, workplace, pay); descriptions are on each
 * job page as JSON-LD.
 */
export type ApplicantProJob = {
  id: number;
  title: string;
  city?: string;
  abbreviation?: string;
  iso3?: string;
  classification?: string;
  orgTitle?: string;
  startDateRef?: string;
  workplaceType?: string;
  payType?: string;
  minSalary?: string;
  maxSalary?: string;
  jobUrl?: string;
};

const DOMAINS = new Set(["applicantpro.com", "isolvedhire.com"]);
const ACCOUNT = /^[a-z0-9][a-z0-9-]*$/i;
const WORKPLACE: Record<string, Workplace> = { onsite: "onsite", "on-site": "onsite", remote: "remote", hybrid: "hybrid" };
const PERIOD: Record<string, string> = { hourly: "hour", salary: "year", yearly: "year", annual: "year", weekly: "week", monthly: "month", daily: "day" };

const base = (ref: { slug: string; shard?: string }) => {
  const domain = ref.shard && DOMAINS.has(ref.shard) ? ref.shard : "applicantpro.com";
  if (!ACCOUNT.test(ref.slug)) throw new Error(`ApplicantPro account should be a subdomain name, got "${ref.slug}"`);
  return `https://${ref.slug.toLowerCase()}.${domain}`;
};

/** The site id the jobs call needs: from `site`, else from the careers page ("domain_id = '11220'"). */
async function siteId(ref: { slug: string; shard?: string; site?: string }, http: Ctx["http"]): Promise<string> {
  if (ref.site && /^\d+$/.test(ref.site)) return ref.site;
  const html = await http.getText(`${base(ref)}/jobs/`);
  const id = html.match(/domain_id\s*=\s*'(\d+)'/)?.[1] ?? html.match(/"domain_id":"(\d+)"/)?.[1];
  if (!id) throw new Error(`ApplicantPro site "${ref.slug}" not found (no site id on its careers page)`);
  return id;
}

/** "45,000.00" -> 45000. */
const amount = (s?: string) => {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const applicantpro: Connector<ApplicantProJob> = {
  ats: "applicantpro",

  detect(url) {
    const m = url.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.(applicantpro\.com|isolvedhire\.com)$/);
    if (!m || ["www", "app", "api", "help", "support"].includes(m[1]!)) return null;
    return { ats: "applicantpro", slug: m[1]!, shard: m[2]! };
  },

  async fetch(ref, { http }) {
    const id = await siteId(ref, http);
    const res = await http.getJson<{ success?: boolean; data?: { jobs?: ApplicantProJob[] } }>(`${base(ref)}/core/jobs/${id}?getParams=${encodeURIComponent(JSON.stringify({ isInternal: 0 }))}`);
    if (!Array.isArray(res.data?.jobs)) throw new Error("unexpected ApplicantPro response: no job list");
    return res.data.jobs;
  },

  async describe(raw, ref, { http }) {
    const ld = jobPostingLd(await http.getText(raw.jobUrl ?? `${base(ref)}/jobs/${raw.id}`));
    return htmlToText(ld?.description ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    const country = iso3Country(raw.iso3);
    const workplace = WORKPLACE[(raw.workplaceType ?? "").toLowerCase()];
    const location = joinParts(joinParts(raw.city, raw.abbreviation), raw.iso3 && raw.iso3 !== "USA" ? country : undefined, workplace === "remote" ? "Remote" : undefined);
    const min = amount(raw.minSalary);
    const max = amount(raw.maxSalary);
    const salary: Salary | undefined =
      min || max
        ? { ...(min ? { min } : {}), ...(max ? { max } : {}), currency: "USD", ...(PERIOD[(raw.payType ?? "").toLowerCase()] ? { period: PERIOD[(raw.payType ?? "").toLowerCase()] } : {}) }
        : undefined;
    const posted = raw.startDateRef ? Date.parse(`${raw.startDateRef} UTC`) : Number.NaN;
    return {
      id: jobId("applicantpro", ref.slug, String(raw.id)),
      ats: "applicantpro",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country,
      workplace: workplace ?? inferWorkplace(location),
      department: [raw.classification, raw.orgTitle].find((d) => d && !/^other$/i.test(d)) || undefined,
      ...(salary ? { salary } : {}),
      postedAt: Number.isNaN(posted) ? undefined : new Date(posted).toISOString(),
      url: raw.jobUrl ?? `${base(ref)}/jobs/${raw.id}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
