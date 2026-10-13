import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { countryName, joinParts } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Cornerstone OnDemand (CSOD) career sites, used by large employers: {tenant}.csod.com. The
 * careers page carries its regional API base and an anonymous read token (what the page itself
 * searches with); with it, rec-job-search/external/jobs lists every requisition, 25 a page,
 * descriptions included.
 */
export type CornerstoneRequisition = {
  requisitionId: number;
  displayJobTitle: string;
  postingEffectiveDate?: string;
  locations?: { city?: string; state?: string; country?: string }[];
  externalDescription?: string;
};

const TENANT = /^[a-z0-9][a-z0-9-]*$/i;
const PAGE = 25;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;

const home = (slug: string) => `https://${slug.toLowerCase()}.csod.com/ux/ats/careersite/1/home?c=${slug.toLowerCase()}`;

/** The careers page's API base, read token and culture. */
async function session(slug: string, http: Ctx["http"]) {
  const html = await http.getText(home(slug));
  const api = html.match(/"endpoints"\s*:\s*\{[^}]*"cloud"\s*:\s*"(https:\/\/[a-z0-9.-]+\.csod\.com\/?)"/)?.[1];
  const token = html.match(/"token"\s*:\s*"(eyJ[^"]+)"/)?.[1];
  if (!api || !token) throw new Error(`Cornerstone careers site "${slug}" not found`);
  return {
    url: `${api.replace(/\/$/, "")}/rec-job-search/external/jobs`,
    token,
    cultureId: Number(html.match(/"cultureID"\s*:\s*(\d+)/i)?.[1] ?? 1),
    cultureName: html.match(/"cultureName"\s*:\s*"([a-z]{2}-[A-Z]{2})"/i)?.[1] ?? "en-US",
  };
}

/** "10/12/2026" (MM/DD/YYYY) -> ISO. */
function date(s?: string): string | undefined {
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))).toISOString() : undefined;
}

export const cornerstone: Connector<CornerstoneRequisition> = {
  ats: "cornerstone",

  detect(url) {
    const sub = url.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.csod\.com$/)?.[1];
    return sub && !["www", "api", "us", "eu-fra"].includes(sub) ? { ats: "cornerstone", slug: sub } : null;
  },

  async fetch(ref, { http, partial }) {
    if (!TENANT.test(ref.slug)) throw new Error(`Cornerstone tenant should be a subdomain name, got "${ref.slug}"`);
    const s = await session(ref.slug, http);
    const out: CornerstoneRequisition[] = [];
    let total = 0;
    for (let page = 1; out.length < MAX_POSTINGS; page++) {
      const res = await http.request(s.url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${s.token}` },
        body: JSON.stringify({
          careerSiteId: 1,
          careerSitePageId: 1,
          pageNumber: page,
          pageSize: PAGE,
          cultureId: s.cultureId,
          cultureName: s.cultureName,
          searchText: "",
          states: [],
          countryCodes: [],
          cities: [],
          customFieldCheckboxKeys: [],
          customFieldDropdowns: [],
          customFieldRadios: [],
        }),
      });
      const d = ((await res.json()) as { data?: { totalCount?: number; requisitions?: CornerstoneRequisition[] } }).data;
      if (!Array.isArray(d?.requisitions)) throw new Error("unexpected Cornerstone response: no requisitions");
      out.push(...d.requisitions);
      total = d.totalCount ?? 0;
      if (!d.requisitions.length || out.length >= total) break;
    }
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const places = [...new Set((raw.locations ?? []).map((l) => joinParts(l.city, l.state, countryName(l.country))))].filter(Boolean);
    const location = places.join("; ");
    return {
      id: jobId("cornerstone", ref.slug, String(raw.requisitionId)),
      ats: "cornerstone",
      company: ref.name,
      title: raw.displayJobTitle.trim(),
      location,
      country: countryName(raw.locations?.[0]?.country),
      workplace: inferWorkplace(`${location} ${raw.displayJobTitle}`),
      postedAt: date(raw.postingEffectiveDate),
      url: `https://${ref.slug.toLowerCase()}.csod.com/ux/ats/careersite/1/home/requisition/${raw.requisitionId}?c=${ref.slug.toLowerCase()}`,
      description: htmlToText(raw.externalDescription ?? ""),
    };
  },
};
