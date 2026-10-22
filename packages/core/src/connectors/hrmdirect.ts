import { HttpError } from "../http";
import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { countryName, joinParts } from "./parse";
import { type Ctx, jobCompanyKey, jobId, type Connector } from "./types";

/**
 * HRMDirect (ClearCompany's careers sites): {account}.hrmdirect.com/employment/. Its openings page
 * lists every job, one row per job and location (title, plus the department, city and state
 * columns most sites show); each job page holds the description in div.jobDesc and a
 * Department/Location table, which fills in the place when the list leaves it out.
 *
 * Since October 2026 the accounts redirect to ClearCompany's own careers site
 * (apply.clearcompany.com/{account}), whose page names a site id for careers-api.clearcompany.com:
 * every job, descriptions included, 100 to a page. The site id is kept in Ctx.ids, so later reads
 * skip the page. An account that hasn't moved is still read the old way.
 */
type HrmDirectRow = { req: string; loc: string; title: string; department?: string; city?: string; state?: string };
type ClearCompanyJob = {
  id: string;
  positionTitle: string;
  description?: string | null;
  postedDate?: string | null;
  departmentName?: string | null;
  locations?: { city?: string | null; subdivision?: string | null; country?: string | null; isRemote?: boolean | null }[] | null;
  applyLink?: string | null;
};
export type HrmDirectJob = HrmDirectRow | { cc: ClearCompanyJob };

const CC_API = "https://careers-api.clearcompany.com/v1";
/** The source the careers page itself asks for (its data-default-source). */
const CC_SOURCE = "CJB-0";
const CC_PAGE = 100;
/** Beyond this we stop paging. */
const CC_MAX = 5000;
const SITE_ID = /data-site-id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

async function clearCompanyJobs(siteId: string, http: Ctx["http"], partial?: () => void): Promise<HrmDirectJob[]> {
  const out: HrmDirectJob[] = [];
  let total = 0;
  for (let page = 0; out.length < CC_MAX; page++) {
    const res = await http.getJson<{ results?: ClearCompanyJob[]; totalCount?: number }>(`${CC_API}/${siteId}?pageIndex=${page}&pageSize=${CC_PAGE}&source=${CC_SOURCE}`);
    if (!Array.isArray(res.results)) throw new Error("unexpected ClearCompany response: no results");
    out.push(...res.results.map((cc) => ({ cc })));
    total = res.totalCount ?? 0;
    if (res.results.length < CC_PAGE || out.length >= total) break;
  }
  // Stopped at the cap well short of the total the site reports.
  if (total - out.length >= CC_PAGE) partial?.();
  return out;
}

/** "2026-10-22T00:00:00" (UTC, no zone) as ISO, or undefined when it isn't a date. */
function postedAt(value: string | null | undefined): string | undefined {
  const ms = value ? Date.parse(`${value.slice(0, 19)}Z`) : Number.NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

const ACCOUNT = /^[a-z0-9][a-z0-9-]*$/i;

const base = (slug: string) => {
  if (!ACCOUNT.test(slug)) throw new Error(`HRMDirect account should be a subdomain name, got "${slug}"`);
  return `https://${slug.toLowerCase()}.hrmdirect.com/employment`;
};
const text = (html: string | undefined) => (html ? htmlToText(decodeEntities(html)).replace(/\s+/g, " ").trim() : "");
const cell = (row: string, cls: string) => text(row.match(new RegExp(`<td[^>]*class="${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</td>`))?.[1]) || undefined;

/** Every row of the openings page (a job open in two places is two rows). */
export function parseHrmDirectOpenings(html: string): HrmDirectRow[] {
  const out: HrmDirectRow[] = [];
  const seen = new Set<string>();
  for (const row of html.split(/(?=<tr class="reqitem)/).slice(1)) {
    const ids = row.match(/job-opening\.php\?req=(\d+)&(?:amp;)?req_loc=(\d+)/);
    const title = text(row.match(/class="posTitle[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)(?:<\/a>|<\/td>)/)?.[1]);
    if (!ids || !title || seen.has(`${ids[1]}-${ids[2]}`)) continue;
    seen.add(`${ids[1]}-${ids[2]}`);
    out.push({ req: ids[1]!, loc: ids[2]!, title, department: cell(row, "departments"), city: cell(row, "cities"), state: cell(row, "state") });
  }
  return out;
}

/** A job page's labelled field ("Location:" -> "Brooklyn, NY"). */
const field = (html: string, label: string) =>
  text(html.match(new RegExp(`<td class="viewFieldName"[^>]*>\\s*(?:<b>)?\\s*${label}:?\\s*(?:</b>)?\\s*</td>\\s*<td class="viewFieldValue"[^>]*>([\\s\\S]*?)</td>`, "i"))?.[1]);

/** div.jobDesc, nested divs included. */
function jobDesc(html: string): string {
  const start = html.search(/<div class="jobDesc"/);
  if (start < 0) return "";
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return htmlToText(html.slice(start, start + m.index! + m[0].length));
  }
  return htmlToText(html.slice(start));
}

export const hrmdirect: Connector<HrmDirectJob> = {
  ats: "hrmdirect",

  detect(url) {
    const sub = url.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.hrmdirect\.com$/)?.[1];
    return sub && !["www", "app", "api"].includes(sub) ? { ats: "hrmdirect", slug: sub } : null;
  },

  async fetch(ref, { http, ids, partial }) {
    const key = jobCompanyKey(ref);
    const known = ids?.get(key);
    if (known) {
      // A site id that stopped answering: look the account up again below.
      try {
        return await clearCompanyJobs(known, http, partial);
      } catch (err) {
        if (!(err instanceof HttpError && (err.status === 404 || err.status === 410))) throw err;
      }
    }
    // Followed to apply.clearcompany.com when the account has moved there.
    const html = await http.getText(`${base(ref.slug)}/job-openings.php?search=true`);
    const site = html.match(SITE_ID)?.[1];
    if (site) {
      ids?.set(key, site);
      return clearCompanyJobs(site, http, partial);
    }
    if (!/reqitem|job-opening\.php|Careers At/i.test(html)) throw new Error(`HRMDirect careers site "${ref.slug}" not found`);
    return parseHrmDirectOpenings(html);
  },

  // Sites that hide the city/state columns: the job page has the place. ClearCompany jobs always carry theirs.
  vagueLocation: (raw) => !("cc" in raw) && !raw.city && !raw.state,

  async describe(raw, ref, { http }) {
    if ("cc" in raw) return { description: text(raw.cc.description ?? undefined) };
    const html = await http.getText(`${base(ref.slug)}/job-opening.php?req=${raw.req}&req_loc=${raw.loc}`);
    const location = field(html, "Location");
    return { description: jobDesc(html), ...(location ? { location, workplace: inferWorkplace(location) } : {}) };
  },

  normalize(raw, ref): NormalizedJob {
    if ("cc" in raw) {
      const cc = raw.cc;
      const places = [...new Set((cc.locations ?? []).map((l) => joinParts(l.city, l.subdivision, l.country && l.country !== "US" ? countryName(l.country) : undefined)))].filter(Boolean);
      const remote = (cc.locations ?? []).some((l) => l.isRemote);
      const location = joinParts(places.join("; "), remote ? "Remote" : undefined);
      const code = cc.locations?.[0]?.country;
      return {
        id: jobId("hrmdirect", ref.slug, cc.id),
        ats: "hrmdirect",
        company: ref.name,
        title: cc.positionTitle.trim(),
        location,
        country: code ? countryName(code) : undefined,
        workplace: remote ? "remote" : inferWorkplace(`${location} ${cc.positionTitle}`),
        department: cc.departmentName ?? undefined,
        postedAt: postedAt(cc.postedDate),
        // The job's page: its apply link without the form.
        url: cc.applyLink ? cc.applyLink.replace(/\/apply(\?.*)?$/, "") : `https://apply.clearcompany.com/${ref.slug.toLowerCase()}`,
        description: text(cc.description ?? undefined),
      };
    }
    const location = joinParts(raw.city, raw.state);
    return {
      id: jobId("hrmdirect", ref.slug, `${raw.req}-${raw.loc}`),
      ats: "hrmdirect",
      company: ref.name,
      title: raw.title,
      location,
      workplace: inferWorkplace(`${location} ${raw.title}`),
      department: raw.department,
      url: `${base(ref.slug)}/job-opening.php?req=${raw.req}&req_loc=${raw.loc}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
