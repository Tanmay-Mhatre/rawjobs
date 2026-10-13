import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { firstPathSegment, jobId, type Connector } from "./types";
import { iso3Country, joinParts } from "./parse";

/**
 * Gem job boards: jobs.gem.com/{board}. The board page's own public GraphQL endpoint lists its
 * postings (title, places, office/remote) and gives each one's description.
 */
export type GemPosting = {
  extId: string;
  title: string;
  locations?: { city?: string; isoCountry?: string | null; isRemote?: boolean }[];
  job?: { locationType?: string };
};

const API = "https://jobs.gem.com/api/public/graphql";
const BOARD = /^[a-z0-9][a-z0-9_-]*$/i;
const LIST = "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { extId title locations { city isoCountry isRemote } job { locationType } } } }";
const DETAIL = "query ExternalJobPostingQuery($boardId: String!, $extId: String!) { oatsExternalJobPosting(boardId: $boardId, extId: $extId) { descriptionHtml firstPublishedTsSec } }";
const WORKPLACE: Record<string, Workplace> = { IN_OFFICE: "onsite", REMOTE: "remote", HYBRID: "hybrid" };

const board = (slug: string) => {
  if (!BOARD.test(slug)) throw new Error(`Gem board should be a plain name, got "${slug}"`);
  return slug.toLowerCase();
};

export const gem: Connector<GemPosting> = {
  ats: "gem",

  detect(url) {
    if (url.hostname.toLowerCase() !== "jobs.gem.com") return null;
    const slug = firstPathSegment(url);
    return slug && BOARD.test(slug) && slug !== "api" ? { ats: "gem", slug: slug.toLowerCase() } : null;
  },

  async fetch(ref, { http }) {
    const res = await http.postJson<{ data?: { oatsExternalJobPostings?: { jobPostings?: GemPosting[] } | null }; errors?: { message?: string }[] }>(API, {
      operationName: "JobBoardList",
      query: LIST,
      variables: { boardId: board(ref.slug) },
    });
    const list = res.data?.oatsExternalJobPostings?.jobPostings;
    if (!Array.isArray(list)) throw new Error(`Gem board "${ref.slug}" not found${res.errors?.[0]?.message ? ` (${res.errors[0].message})` : ""}`);
    return list;
  },

  async describe(raw, ref, { http }) {
    const res = await http.postJson<{ data?: { oatsExternalJobPosting?: { descriptionHtml?: string; firstPublishedTsSec?: number } | null } }>(API, {
      operationName: "ExternalJobPostingQuery",
      query: DETAIL,
      variables: { boardId: board(ref.slug), extId: raw.extId },
    });
    const p = res.data?.oatsExternalJobPosting;
    return { description: htmlToText(p?.descriptionHtml ?? ""), ...(p?.firstPublishedTsSec ? { postedAt: new Date(p.firstPublishedTsSec * 1000).toISOString() } : {}) };
  },

  normalize(raw, ref): NormalizedJob {
    const places = [...new Set((raw.locations ?? []).map((l) => joinParts(l.city, iso3Country(l.isoCountry))))].filter(Boolean);
    const remote = raw.job?.locationType === "REMOTE" || (raw.locations ?? []).some((l) => l.isRemote);
    const workplace = remote ? "remote" : (WORKPLACE[raw.job?.locationType ?? ""] ?? undefined);
    const location = joinParts(places.join("; "), remote ? "Remote" : undefined);
    return {
      id: jobId("gem", ref.slug, raw.extId),
      ats: "gem",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: iso3Country(raw.locations?.[0]?.isoCountry),
      workplace: workplace ?? inferWorkplace(location),
      url: `https://jobs.gem.com/${board(ref.slug)}/${raw.extId}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
