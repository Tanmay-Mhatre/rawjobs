import type { NormalizedJob, Salary } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { jobPostingLd } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * HiringThing, white-labelled by payroll and HR firms: the same careers sites run on
 * {tenant}.hiringthing.com and on each reseller's domain (prismhr-hire.com, oasisrecruit.com…).
 * Kept as slug = the site's host. The site's root page lists every job (title, place, pay);
 * descriptions come from each job page's JSON-LD.
 */
export type HiringThingJob = { id: string; path: string; title: string; location: string; salary?: Salary };

/** The vendor's domain and its resellers' (as seen in public board lists). */
export const HIRINGTHING_DOMAINS = [
  "hiringthing.com",
  "prismhr-hire.com",
  "oasisrecruit.com",
  "verahr-hiring.com",
  "gnahiring.com",
  "rippling-ats.com",
  "iconnecthire.com",
  "primepay-recruit.com",
  "viewpointhr-ats.com",
  "nexstarrecruiter.com",
  "exponentats.com",
  "alphastaff-hiring.com",
];
const HOST = new RegExp(`^[a-z0-9][a-z0-9-]*\\.(${HIRINGTHING_DOMAINS.map((d) => d.replace(/\./g, "\\.")).join("|")})$`, "i");

const base = (slug: string) => {
  if (!HOST.test(slug)) throw new Error(`not a HiringThing careers site: "${slug}"`);
  return `https://${slug.toLowerCase()}`;
};

/** {"minSalary":{"amount":"20.00","currency":"USD"},"maxSalary":…,"payFrequency":"hourly"} from the row's JobSalary props. */
function salaryOf(row: string): Salary | undefined {
  const props = row.match(/data-react-class="HiringThing\.Components\.JobSalary" data-react-props="([^"]*)"/)?.[1];
  if (!props) return undefined;
  try {
    const p = JSON.parse(decodeEntities(props)) as { minSalary?: { amount?: string; currency?: string }; maxSalary?: { amount?: string; currency?: string }; payFrequency?: string };
    const min = Number(p.minSalary?.amount);
    const max = Number(p.maxSalary?.amount);
    if (!(min > 0) && !(max > 0)) return undefined;
    const period = { hourly: "hour", annually: "year", yearly: "year", salary: "year", monthly: "month", weekly: "week" }[(p.payFrequency ?? "").toLowerCase()];
    return { ...(min > 0 ? { min } : {}), ...(max > 0 ? { max } : {}), currency: p.minSalary?.currency || p.maxSalary?.currency || "USD", ...(period ? { period } : {}) };
  } catch {
    return undefined;
  }
}

/** Every job on a careers site's root page. */
export function parseHiringThingPage(html: string): HiringThingJob[] {
  const out: HiringThingJob[] = [];
  for (const row of html.split(/(?=<div class="job-container")/).slice(1)) {
    const link = row.match(/href="(\/job\/(\d+)\/[^"]*)"/);
    const title = htmlToText(row.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] ?? "").trim();
    if (!link || !title) continue;
    const location = htmlToText(row.match(/<div class="job-location">([\s\S]*?)<\/div>/)?.[1] ?? "").trim();
    const salary = salaryOf(row);
    out.push({ id: link[2]!, path: link[1]!, title, location, ...(salary ? { salary } : {}) });
  }
  return out;
}

export const hiringthing: Connector<HiringThingJob> = {
  ats: "hiringthing",

  detect(url) {
    const host = url.hostname.toLowerCase();
    return HOST.test(host) && !/^(www|app|api|help)\./.test(host) ? { ats: "hiringthing", slug: host } : null;
  },

  async fetch(ref, { http }) {
    const html = await http.getText(`${base(ref.slug)}/`);
    if (!/job-container|HiringThing/i.test(html)) throw new Error(`HiringThing careers site "${ref.slug}" not found`);
    return parseHiringThingPage(html);
  },

  async describe(raw, ref, { http }) {
    return htmlToText(jobPostingLd(await http.getText(`${base(ref.slug)}${raw.path}`))?.description ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("hiringthing", ref.slug, raw.id),
      ats: "hiringthing",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      ...(raw.salary ? { salary: raw.salary } : {}),
      url: `${base(ref.slug)}${raw.path}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
