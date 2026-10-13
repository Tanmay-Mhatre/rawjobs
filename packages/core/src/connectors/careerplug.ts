import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { jobPostingLd } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * CareerPlug, hiring software for US small businesses and franchises. Careers sites are
 * {account}.careerplug.com/jobs: server-rendered pages of 30 jobs (title, location, date), each
 * job page carrying a schema.org JobPosting for the description.
 */
export type CareerPlugJob = { id: string; title: string; location: string; posted?: string };

const SUB = /^[a-z0-9][a-z0-9-]*$/i;
/** Beyond this we stop paging (30 jobs a page). */
const MAX_PAGES = 30;

const base = (slug: string) => {
  if (!SUB.test(slug)) throw new Error(`CareerPlug account should be a subdomain name, got "${slug}"`);
  return `https://${slug.toLowerCase()}.careerplug.com`;
};

const inner = (row: string, cls: string) =>
  htmlToText(row.match(new RegExp(`class="${cls}[^"]*"[^>]*>([\\s\\S]*?)</div>\\s*</div>`))?.[1] ?? "")
    .replace(/^(Location|Post Date):\s*/i, "")
    .trim();

/** One page of the job list. */
export function parseCareerPlugPage(html: string): CareerPlugJob[] {
  const out: CareerPlugJob[] = [];
  for (const row of html.split(/<a\b(?=[^>]*href="\/jobs\/\d+")/).slice(1)) {
    const id = row.match(/^[^>]*href="\/jobs\/(\d+)"/)?.[1];
    const title = htmlToText(row.match(/<span class="name">([\s\S]*?)<\/span>/)?.[1] ?? "").trim();
    if (!id || !title) continue;
    out.push({ id, title, location: inner(row, "job-location"), posted: inner(row, "job-post-date") || undefined });
  }
  return out;
}

/** "FL-Naples-34109" -> "Naples, FL"; anything else as given. */
function place(s: string): string {
  const m = s.match(/^([A-Z]{2})-(.+?)(?:-\d{5}(?:-\d{4})?)?$/);
  return m ? `${m[2]!.replace(/-/g, " ")}, ${m[1]}` : s;
}

/** "10-13-26" (MM-DD-YY) -> ISO date. */
function date(s?: string): string | undefined {
  const m = s?.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(2000 + Number(m[3]), Number(m[1]) - 1, Number(m[2]))).toISOString() : undefined;
}

export const careerplug: Connector<CareerPlugJob> = {
  ats: "careerplug",

  detect(url) {
    const host = url.hostname.toLowerCase();
    const sub = host.match(/^([a-z0-9][a-z0-9-]*)\.careerplug\.com$/)?.[1];
    return sub && !["www", "app", "api", "help", "blog"].includes(sub) ? { ats: "careerplug", slug: sub } : null;
  },

  async fetch(ref, { http, partial }) {
    const out = new Map<string, CareerPlugJob>();
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) {
        partial?.();
        break;
      }
      const html = await http.getText(`${base(ref.slug)}/jobs${page > 1 ? `?page=${page}` : ""}`);
      if (page === 1 && !/careerplug/i.test(html)) throw new Error(`CareerPlug site "${ref.slug}" not found`);
      const before = out.size;
      for (const j of parseCareerPlugPage(html)) out.set(j.id, j);
      if (out.size === before || !/rel="next"/.test(html)) break;
    }
    return [...out.values()];
  },

  async describe(raw, ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${base(ref.slug)}/jobs/${raw.id}`));
    return htmlToText(ld?.description ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    const location = place(raw.location);
    return {
      id: jobId("careerplug", ref.slug, raw.id),
      ats: "careerplug",
      company: ref.name,
      title: raw.title,
      location,
      workplace: inferWorkplace(location),
      postedAt: date(raw.posted),
      url: `${base(ref.slug)}/jobs/${raw.id}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
