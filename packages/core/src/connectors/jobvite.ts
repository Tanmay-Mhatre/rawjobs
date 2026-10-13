import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, inlineText } from "./parse";
import { jobId, type Connector } from "./types";

/** A row of a Jobvite careers page's search list (Jobvite has no keyless feed; this is the page itself). */
export type JobviteJob = { id: string; title: string; location: string };

/** Pages of 50; beyond this we stop. */
const MAX_PAGES = 40;

const BASE = "https://jobs.jobvite.com";

export function parseJobvitePage(html: string, slug: string): JobviteJob[] {
  const out = new Map<string, JobviteJob>();
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<a[^>]+href="/${esc}/job/([A-Za-z0-9]+)"[^>]*>([\\s\\S]*?)</a>`, "gi");
  for (const m of html.matchAll(re)) {
    const id = m[1]!;
    // Location: the next jv-…-location cell after the link ("2 Locations" when several).
    const rest = html.slice(m.index! + m[0].length, m.index! + m[0].length + 1500);
    const loc = rest.match(/class="jv-(?:job-list|featured-job)-location"[^>]*>([\s\S]*?)<\/(?:td|div)>/)?.[1];
    const title = inlineText(m[2]);
    if (title && !out.has(id)) out.set(id, { id, title, location: inlineText(loc).replace(/\s*,\s*/g, ", ") });
  }
  return [...out.values()];
}

export const jobvite: Connector<JobviteJob> = {
  ats: "jobvite",
  detect: detectAs("jobvite"),

  async fetch(ref, { http, partial }) {
    const out = new Map<string, JobviteJob>();
    for (let p = 0; ; p++) {
      // Still a next page after the last one we read: the list was cut short.
      if (p === MAX_PAGES) {
        partial?.();
        break;
      }
      const html = await http.getText(`${BASE}/${encodeURIComponent(ref.slug)}/search?p=${p}`);
      const before = out.size;
      for (const j of parseJobvitePage(html, ref.slug)) out.set(j.id, j);
      if (out.size === before || !/class="jv-pagination-next"/.test(html)) break;
    }
    return [...out.values()];
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("jobvite", ref.slug, raw.id),
      ats: "jobvite",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(raw.location),
      url: `${BASE}/${ref.slug}/job/${raw.id}`,
      description: "",
    };
  },

  vagueLocation: (raw) => /^\d+ locations?$/i.test(raw.location),

  async describe(raw, ref, { http }) {
    const html = await http.getText(`${BASE}/${encodeURIComponent(ref.slug)}/job/${raw.id}`);
    const body = html.match(/class="jv-job-detail-description"[^>]*>([\s\S]*?)<div class="jv-job-detail-bottom-actions/)?.[1];
    const meta = inlineText(html.match(/class="jv-job-detail-meta"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
    // The meta line reads "Department · Location" (several locations separated by commas).
    const location =
      meta
        .split(/\s*[·|•]\s*/)
        .slice(1)
        .join(", ") || undefined;
    return { description: htmlToText(body), location: /^\d+ locations?$/i.test(raw.location) ? location : undefined };
  },
};
