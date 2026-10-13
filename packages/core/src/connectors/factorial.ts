import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { jobId, type Connector } from "./types";

/**
 * Factorial (FactorialHR), HR software big with European SMBs. Careers sites live on
 * {tenant}.factorial.es / factorialhr.com / factorial.it / factorialhr.de…, the domain varying by
 * country, so the board is the host. The root page lists every job under its office (title,
 * remote flag); each job page holds the description in div.styledText.
 */
export type FactorialJob = { id: string; url: string; title: string; office?: string; remote: boolean };

const HOST = /^[a-z0-9][a-z0-9-]*\.factorial(hr)?\.(com|es|it|de|fr|pt|mx|ch|pl|be|co|co\.uk|com\.br)$/i;

const base = (slug: string) => {
  if (!HOST.test(slug)) throw new Error(`not a Factorial careers site: "${slug}"`);
  return `https://${slug.toLowerCase()}`;
};
const text = (html: string | undefined) => (html ? htmlToText(decodeEntities(html)).replace(/\s+/g, " ").trim() : "");

/** Every job on a careers site's root page, with the office heading it sits under. */
export function parseFactorialPage(html: string): FactorialJob[] {
  const out: FactorialJob[] = [];
  let office: string | undefined;
  for (const part of html.split(/(?=<h3\b)|(?=<li class='job-offer-item)/)) {
    if (part.startsWith("<h3")) {
      office = text(part.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]) || undefined;
      continue;
    }
    if (!part.startsWith("<li class='job-offer-item")) continue;
    const url = part.match(/data-job-postings-url='([^']+)'/)?.[1];
    const id = url?.match(/-(\d+)\/?$/)?.[1];
    const title = text(part.match(/factorial__headingFontFamily">([\s\S]*?)<\/div>/)?.[1]);
    if (!url || !id || !title) continue;
    out.push({ id, url, title, office, remote: /data-is-remote='true'/.test(part) });
  }
  return out;
}

/** The job page's description: div.styledText, nested divs included. */
export function factorialDescription(html: string): string {
  const start = html.search(/<div class=['"]styledText['"]/);
  if (start < 0) return "";
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return htmlToText(html.slice(start, start + m.index! + m[0].length));
  }
  return htmlToText(html.slice(start));
}

export const factorial: Connector<FactorialJob> = {
  ats: "factorial",

  detect(url) {
    const host = url.hostname.toLowerCase();
    return HOST.test(host) && !/^(www|app|api|help)\./.test(host) ? { ats: "factorial", slug: host } : null;
  },

  async fetch(ref, { http }) {
    const html = await http.getText(`${base(ref.slug)}/`);
    if (!/job-offer-item|factorial__/i.test(html)) throw new Error(`Factorial careers site "${ref.slug}" not found`);
    return parseFactorialPage(html);
  },

  async describe(raw, ref, { http }) {
    // Only the site's own job pages.
    const url = raw.url.startsWith(`${base(ref.slug)}/`) ? raw.url : `${base(ref.slug)}/job_posting/${raw.id}`;
    return factorialDescription(await http.getText(url));
  },

  normalize(raw, ref): NormalizedJob {
    const location = [raw.office, raw.remote ? "Remote" : undefined].filter(Boolean).join(", ");
    return {
      id: jobId("factorial", ref.slug, raw.id),
      ats: "factorial",
      company: ref.name,
      title: raw.title,
      location,
      workplace: raw.remote ? "remote" : inferWorkplace(location),
      url: raw.url.startsWith(`${base(ref.slug)}/`) ? raw.url : `${base(ref.slug)}/job_posting/${raw.id}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
