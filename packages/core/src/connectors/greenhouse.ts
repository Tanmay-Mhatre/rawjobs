import type { CompanyRef, NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { firstPathSegment, jobId, type Connector } from "./types";

/** https://developers.greenhouse.io/job-board.html */
export type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string | null } | null;
  /** HTML, entity-escaped (so "&lt;p&gt;"). */
  content?: string | null;
  departments?: { name: string }[];
  offices?: { name: string; location?: string | null }[];
  first_published?: string | null;
  updated_at?: string;
};

/**
 * One API serves every board, including EU-hosted ones (job-boards.eu.greenhouse.io):
 * there is no boards-api.eu host (verified 2026-10-04). Region only changes the public job links.
 */
const API = "https://boards-api.greenhouse.io";

export const greenhouse: Connector<GreenhouseJob> = {
  ats: "greenhouse",

  detect(url) {
    const host = url.hostname.toLowerCase();
    // Board hosts only (boards., job-boards., boards-api., and their .eu. forms), not greenhouse.io's own site.
    if (!/^(job-)?boards(-api)?\.(eu\.)?greenhouse\.io$/.test(host)) return null;
    const region = host.includes(".eu.") ? "eu" : undefined;
    // Embedded boards: boards.greenhouse.io/embed/job_board?for=acme
    const forParam = url.searchParams.get("for");
    if (forParam) return { ats: "greenhouse", slug: forParam, region };
    // API URL: boards-api.greenhouse.io/v1/boards/acme/jobs
    const api = url.pathname.match(/\/v1\/boards\/([^/]+)/);
    if (api?.[1]) return { ats: "greenhouse", slug: decodeURIComponent(api[1]), region };
    const slug = firstPathSegment(url);
    if (!slug || slug === "embed") return null;
    return { ats: "greenhouse", slug, region };
  },

  /**
   * The light list (content=false) is ~25x smaller than with descriptions (Stripe: 34 KB vs 891 KB
   * gzipped, 2026-10-09) and answers 304 when unchanged; describe() fetches the jobs that match.
   */
  async fetch(ref, { http }) {
    const data = await http.getJson<{ jobs?: GreenhouseJob[] }>(`${API}/v1/boards/${encodeURIComponent(ref.slug)}/jobs?content=false`);
    if (!Array.isArray(data.jobs)) throw new Error("unexpected Greenhouse response: no jobs array");
    return data.jobs;
  },

  async describe(raw, ref, { http }) {
    const job = await http.getJson<GreenhouseJob>(`${API}/v1/boards/${encodeURIComponent(ref.slug)}/jobs/${raw.id}`);
    return htmlToText(job.content);
  },

  normalize(raw, ref: CompanyRef): NormalizedJob {
    // Office names often carry the country the free-text location leaves out ("SF, NYC, Remote" + office "US").
    const name = raw.location?.name?.trim() ?? "";
    const offices = (raw.offices ?? []).map((o) => o.name.trim()).filter((o) => o && !name.toLowerCase().includes(o.toLowerCase()));
    const location = name && offices.length ? `${name} (${offices.join("; ")})` : name || offices.join("; ");
    return {
      id: jobId("greenhouse", ref.slug, raw.id),
      ats: "greenhouse",
      company: ref.name,
      title: raw.title.trim(),
      location,
      workplace: inferWorkplace(location),
      department: raw.departments?.[0]?.name,
      postedAt: raw.first_published ?? undefined,
      url: raw.absolute_url,
      description: htmlToText(raw.content),
    };
  },
};
