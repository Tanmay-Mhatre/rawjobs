import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { joinParts } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * HRMDirect (ClearCompany's careers sites): {account}.hrmdirect.com/employment/. Its openings page
 * lists every job, one row per job and location (title, plus the department, city and state
 * columns most sites show); each job page holds the description in div.jobDesc and a
 * Department/Location table, which fills in the place when the list leaves it out.
 */
export type HrmDirectJob = { req: string; loc: string; title: string; department?: string; city?: string; state?: string };

const ACCOUNT = /^[a-z0-9][a-z0-9-]*$/i;

const base = (slug: string) => {
  if (!ACCOUNT.test(slug)) throw new Error(`HRMDirect account should be a subdomain name, got "${slug}"`);
  return `https://${slug.toLowerCase()}.hrmdirect.com/employment`;
};
const text = (html: string | undefined) => (html ? htmlToText(decodeEntities(html)).replace(/\s+/g, " ").trim() : "");
const cell = (row: string, cls: string) => text(row.match(new RegExp(`<td[^>]*class="${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</td>`))?.[1]) || undefined;

/** Every row of the openings page (a job open in two places is two rows). */
export function parseHrmDirectOpenings(html: string): HrmDirectJob[] {
  const out: HrmDirectJob[] = [];
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

  async fetch(ref, { http }) {
    const html = await http.getText(`${base(ref.slug)}/job-openings.php?search=true`);
    if (!/reqitem|job-opening\.php|Careers At/i.test(html)) throw new Error(`HRMDirect careers site "${ref.slug}" not found`);
    return parseHrmDirectOpenings(html);
  },

  // Sites that hide the city/state columns: the job page has the place.
  vagueLocation: (raw) => !raw.city && !raw.state,

  async describe(raw, ref, { http }) {
    const html = await http.getText(`${base(ref.slug)}/job-opening.php?req=${raw.req}&req_loc=${raw.loc}`);
    const location = field(html, "Location");
    return { description: jobDesc(html), ...(location ? { location, workplace: inferWorkplace(location) } : {}) };
  },

  normalize(raw, ref): NormalizedJob {
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
