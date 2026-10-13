import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { firstPathSegment, jobId, type Connector } from "./types";

/**
 * Hireology, hiring software for US small businesses (car dealers, care homes, franchises).
 * Careers sites are careers.hireology.com/{slug}; its public JSON:API at
 * api.hireology.com/v1/careers/{slug} returns every open posting, descriptions included.
 */
export type HireologyPosting = {
  id: string;
  attributes: {
    name: string;
    remote?: boolean;
    "job-description"?: string;
    locations?: string[];
    status?: string;
    "career-site-url"?: string;
    "job-family"?: { name?: string } | null;
  };
};

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

export const hireology: Connector<HireologyPosting> = {
  ats: "hireology",

  detect(url) {
    const host = url.hostname.toLowerCase();
    if (host === "careers.hireology.com") {
      const slug = firstPathSegment(url);
      return slug && SLUG.test(slug) ? { ats: "hireology", slug: slug.toLowerCase() } : null;
    }
    const api = host === "api.hireology.com" ? url.pathname.match(/\/v\d+\/careers\/([^/]+)/) : null;
    return api?.[1] && SLUG.test(api[1]) ? { ats: "hireology", slug: api[1].toLowerCase() } : null;
  },

  async fetch(ref, { http }) {
    const res = await http.getJson<{ data?: HireologyPosting[] }>(`https://api.hireology.com/v1/careers/${encodeURIComponent(ref.slug)}`);
    if (!Array.isArray(res.data)) throw new Error("unexpected Hireology response: no data array");
    return res.data.filter((p) => !p.attributes.status || /open/i.test(p.attributes.status));
  },

  normalize(raw, ref): NormalizedJob {
    const a = raw.attributes;
    const places = (a.locations ?? []).filter(Boolean).join("; ");
    const location = a.remote && !/remote/i.test(places) ? [places, "Remote"].filter(Boolean).join(", ") : places;
    return {
      id: jobId("hireology", ref.slug, raw.id),
      ats: "hireology",
      company: ref.name,
      title: a.name.trim(),
      location,
      workplace: a.remote ? "remote" : inferWorkplace(location),
      department: a["job-family"]?.name && a["job-family"].name !== "General" ? a["job-family"].name : undefined,
      url: a["career-site-url"] || `https://careers.hireology.com/${ref.slug}/${raw.id}/description`,
      description: htmlToText(a["job-description"] ?? ""),
    };
  },
};
