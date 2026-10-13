import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { firstPathSegment, jobId, type Connector } from "./types";

/**
 * Manatal careers pages: www.careers-page.com/{slug}. Manatal's open API lists a page's jobs,
 * descriptions included, without a key: open.api.manatal.com/open/v3/career-page/{slug}/jobs/.
 */
export type ManatalJob = {
  id: number;
  hash: string;
  position_name: string;
  description?: string;
  location_display?: string;
  country?: string;
  is_remote?: boolean;
  contract_details?: string;
};

const API = "https://open.api.manatal.com/open/v3/career-page";
const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const PAGE = 100;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;

export const manatal: Connector<ManatalJob> = {
  ats: "manatal",

  detect(url) {
    const host = url.hostname.toLowerCase();
    if (host !== "www.careers-page.com" && host !== "careers-page.com") return null;
    const slug = firstPathSegment(url);
    return slug && SLUG.test(slug) ? { ats: "manatal", slug: slug.toLowerCase() } : null;
  },

  async fetch(ref, { http, partial }) {
    if (!SLUG.test(ref.slug)) throw new Error(`Manatal careers page should be a plain name, got "${ref.slug}"`);
    const out: ManatalJob[] = [];
    let total = 0;
    for (let page = 1; out.length < MAX_POSTINGS; page++) {
      const res = await http.getJson<{ count?: number; next?: string | null; results?: ManatalJob[] }>(`${API}/${encodeURIComponent(ref.slug)}/jobs/?page=${page}&page_size=${PAGE}`);
      if (!Array.isArray(res.results)) throw new Error("unexpected Manatal response: no results");
      out.push(...res.results);
      total = res.count ?? 0;
      if (!res.next || !res.results.length) break;
    }
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const location = [raw.location_display, raw.is_remote ? "Remote" : undefined].filter(Boolean).join(", ");
    return {
      id: jobId("manatal", ref.slug, raw.hash || String(raw.id)),
      ats: "manatal",
      company: ref.name,
      title: raw.position_name.trim(),
      location,
      country: raw.country || undefined,
      workplace: raw.is_remote ? "remote" : inferWorkplace(location),
      url: `https://www.careers-page.com/${ref.slug}/job/${raw.hash}`,
      description: htmlToText(raw.description ?? ""),
    };
  },
};
