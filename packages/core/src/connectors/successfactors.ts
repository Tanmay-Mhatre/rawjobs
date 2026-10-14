import type { CompanyRef, NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, xmlBlocks, xmlOne } from "./parse";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/** One <Job> of SAP SuccessFactors' public listing feed (career?…&resultType=XML), descriptions included. */
export type SuccessFactorsJob = {
  reqId: string;
  title: string;
  description: string;
  /** The company's own filters ("Location", "Country", "Department"…), label -> value. */
  filters: Record<string, string>;
  /** Career sites (RMK) only: the job page, and the date the search list shows. */
  url?: string;
  posted?: string;
};

/**
 * SuccessFactors career sites ("RMK": jobs.acme.com, acme.jobs2web.com, acme.jobs.hr.cloud.sap) are
 * keyed by their host. Their search pages list 25 jobs a row each: title, location, date, department.
 */
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export const isCareerSiteHost = (ref: { slug: string; shard?: string }) => !ref.shard && ref.slug.includes(".") && HOST.test(ref.slug);
/** Big employers list thousands of jobs; beyond this we stop paging. */
const MAX_POSTINGS = 2000;

const inlineHtml = (s: string | undefined) => (s ? htmlToText(s).replace(/\s+/g, " ").trim() : "");
const cell = (row: string, cls: string) => inlineHtml(row.match(new RegExp(`class="${cls}[^"]*"[^>]*>([\\s\\S]*?)</span>`))?.[1]);

/**
 * The "tile" template (Career Site Builder): the same /search/ page, rows as
 * <li class="job-tile job-id-{id}" data-url="/job/…/{id}/">, each field a labelled section
 * (job-{id}-desktop-section-{field}-label / -value). Page size varies (10, 25, 50).
 */
function parseTiles(html: string, host: string): SuccessFactorsJob[] {
  const jobs: SuccessFactorsJob[] = [];
  for (const tile of html.split(/<li class="job-tile\b/).slice(1)) {
    const path = tile.match(/data-url="(\/(?:[^"/]+\/)?job\/[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    const reqId = path?.match(/\/(\d+)\/?$/)?.[1];
    const title = inlineHtml(tile.match(/<a\b[^>]*class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1]);
    if (!path || !reqId || !title) continue;
    const filters: Record<string, string> = {};
    let posted: string | undefined;
    for (const m of tile.matchAll(/id="job-\d+-desktop-section-([\w-]+?)-label"[^>]*>([\s\S]*?)<\/span>/g)) {
      const field = m[1]!;
      const value = inlineHtml(tile.match(new RegExp(`id="job-\\d+-desktop-section-${field}-value"[^>]*>([\\s\\S]*?)</div>`))?.[1]);
      if (!value) continue;
      if (field === "date") posted = value;
      else if (field === "location") filters.Location = value;
      else filters[inlineHtml(m[2]) || field] = value;
    }
    jobs.push({ reqId, title, description: "", filters, url: `https://${host}${path}`, posted });
  }
  return jobs;
}

/**
 * One search page of a career site: its job rows, the total it reports ("Results 1 – 25 of 978",
 * or the page script's jobRecordsFound), and whether it is a template we read: the classic table
 * or tiles. (The "Unify" template renders its list in the browser from /services/, which
 * robots.txt closes, so it stays unreadable.)
 */
export function parseCareerSitePage(html: string, host: string): { jobs: SuccessFactorsJob[]; total: number; readable: boolean } {
  const count = html.match(/Results\s*<b>[^<]*<\/b>\s*of\s*<b>([\d,.]+)<\/b>/)?.[1] ?? html.match(/jobRecordsFound:\s*parseInt\("(\d+)"\)/)?.[1] ?? "0";
  const total = Number(count.replace(/[,.]/g, ""));
  // A tile page with no results has no tiles, only its count.
  if (/<li class="job-tile\b/.test(html) || /jobRecordsFound:\s*parseInt\("0"\)/.test(html)) return { jobs: parseTiles(html, host), total, readable: true };
  const jobs: SuccessFactorsJob[] = [];
  for (const row of html.split(/<tr class="data-row/).slice(1)) {
    const link = row.match(/<a\b[^>]*class="jobTitle-link"[^>]*>([\s\S]*?)<\/a>/);
    // Multi-brand sites put the brand first: /AEI/job/…
    const path = link?.[0].match(/href="(\/(?:[^"/]+\/)?job\/[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    const title = inlineHtml(link?.[1]);
    const reqId = path?.match(/\/(\d+)\/?$/)?.[1];
    if (!path || !title || !reqId) continue;
    const filters: Record<string, string> = {};
    const location = cell(row, "jobLocation");
    const department = cell(row, "jobDepartment");
    if (location) filters.Location = location;
    if (department) filters.Department = department;
    jobs.push({ reqId, title, description: "", filters, url: `https://${host}${path}`, posted: cell(row, "jobDate") || undefined });
  }
  return { jobs, total, readable: jobs.length > 0 || /id="searchresults"/.test(html) };
}

/** The job page's description: the schema.org microdata span, nested spans included. */
export function careerSiteDescription(html: string): string {
  const start = html.search(/<span[^>]*itemprop="description"/);
  if (start < 0) return "";
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<(\/?)span\b[^>]*>/g)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return htmlToText(html.slice(start, start + m.index! + m[0].length));
  }
  return htmlToText(html.slice(start));
}

export function parseSuccessFactors(xml: string): SuccessFactorsJob[] {
  return xmlBlocks(xml, "Job").map((j) => {
    const filters: Record<string, string> = {};
    for (const m of j.matchAll(/<(filter\d+)>([\s\S]*?)<\/\1>/g)) {
      const label = xmlOne(m[2]!, "label");
      const value = xmlOne(m[2]!, "value");
      if (label && value) filters[label] = value;
    }
    return { reqId: xmlOne(j, "ReqId"), title: xmlOne(j, "JobTitle"), description: xmlOne(j, "Job-Description"), filters };
  });
}

const pick = (f: Record<string, string>, re: RegExp) => Object.entries(f).find(([k]) => re.test(k))?.[1];

/** career{N}.successfactors.com / .eu: the data centre host, kept in `shard` (else read off the careers link). */
function host(ref: { shard?: string; careers_url?: string }): string {
  if (ref.shard) return ref.shard;
  try {
    const h = ref.careers_url ? new URL(ref.careers_url).hostname : "";
    if (/successfactors\.(com|eu)$|sapsf\.(com|eu)$/.test(h)) return h;
  } catch {
    // not a URL
  }
  return "career4.successfactors.com";
}

/** A career site's search pages for `q` ("" lists every job), up to `max` jobs. */
async function searchCareerSite(ref: CompanyRef, http: Ctx["http"], q: string, max: number) {
  const site = ref.slug.toLowerCase();
  const out: SuccessFactorsJob[] = [];
  const seen = new Set<string>();
  let total = Infinity;
  for (let start = 0; start < Math.min(total, max); ) {
    const page = parseCareerSitePage(await http.getText(`https://${site}/search/?q=${encodeURIComponent(q)}&startrow=${start}`), site);
    if (!page.readable) throw new Error(`${site}: this SuccessFactors career site template isn't readable yet`);
    if (start === 0) total = page.total || page.jobs.length;
    const fresh = page.jobs.filter((j) => !seen.has(j.reqId));
    if (!fresh.length) break;
    for (const j of fresh) seen.add(j.reqId);
    out.push(...fresh);
    start += page.jobs.length;
  }
  return { out, total };
}

export const successfactors: Connector<SuccessFactorsJob> = {
  ats: "successfactors",
  detect: detectAs("successfactors"),

  async fetch(ref, { http, partial }) {
    if (isCareerSiteHost(ref)) {
      const { out, total } = await searchCareerSite(ref, http, "", MAX_POSTINGS);
      // Stopped at the cap well short of the total the site reports.
      if (Number.isFinite(total) && total - out.length >= 25) partial?.();
      return out;
    }
    const xml = await http.getText(`https://${host(ref)}/career?company=${encodeURIComponent(ref.slug)}&career_ns=job_listing_summary&resultType=XML`);
    if (!/<Job-Listing/.test(xml)) throw new Error("unexpected SuccessFactors response: not a job listing feed");
    return parseSuccessFactors(xml);
  },

  // Only career sites are capped; the XML feed always lists every job.
  async search(ref, term, { http }) {
    return isCareerSiteHost(ref) ? (await searchCareerSite(ref, http, term, SEARCH_MAX_POSTINGS)).out : [];
  },

  async describe(raw, _ref, { http }) {
    if (!raw.url) return raw.description ? htmlToText(raw.description) : "";
    return careerSiteDescription(await http.getText(raw.url));
  },

  normalize(raw, ref): NormalizedJob {
    const f = raw.filters;
    const location = [pick(f, /location|city|site|office/i), pick(f, /country/i)].filter(Boolean).join(", ");
    return {
      id: jobId("successfactors", ref.slug, raw.reqId),
      ats: "successfactors",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: pick(f, /country/i),
      workplace: inferWorkplace(`${location} ${pick(f, /remote|workplace/i) ?? ""}`),
      department: pick(f, /department|function|area|category|business ?unit/i),
      ...(raw.posted ? { postedAt: isoDate(`${raw.posted} UTC`) } : {}),
      url: raw.url ?? `https://${host(ref)}/career?company=${encodeURIComponent(ref.slug)}&career_ns=job_listing&career_job_req_id=${raw.reqId}`,
      description: htmlToText(raw.description),
    };
  },
};
