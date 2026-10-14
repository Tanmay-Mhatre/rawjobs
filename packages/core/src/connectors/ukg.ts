import { employmentType } from "../catalog/employment";
import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { joinParts, jsonAfter } from "./parse";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/**
 * UKG Pro Recruiting (formerly UltiPro). A job board lives at
 * {host}/{company code}/JobBoard/{board GUID}, where the host is recruiting{N}.ultipro.com or
 * {name}.rec.pro.ukg.net. Kept as slug = company code, shard = host, site = board GUID. Its public
 * search (the call the board page makes) lists postings; each posting's page embeds its details.
 */
export type UkgOpportunity = {
  Id: string;
  Title: string;
  PostedDate?: string;
  FullTime?: boolean;
  JobCategoryName?: string;
  JobLocationType?: number;
  Locations?: { LocalizedName?: string | null; Address?: { City?: string; State?: { Code?: string; Name?: string }; Country?: { Code?: string; Name?: string } } | null }[];
};

const HOST = /^[a-z0-9-]+\.(ultipro\.com|rec\.pro\.ukg\.net)$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 50;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;
/** JobLocationType, as seen on live boards: 1 on-site, 2 remote (other values: read from the text). */
const LOCATION_TYPE: Record<number, Workplace> = { 1: "onsite", 2: "remote" };

const board = (ref: { slug: string; shard?: string; site?: string }) => {
  if (!ref.shard || !HOST.test(ref.shard) || !ref.site || !GUID.test(ref.site)) throw new Error('UKG boards need "shard" (the host) and "site" (the board GUID) from the careers URL');
  return `https://${ref.shard.toLowerCase()}/${encodeURIComponent(ref.slug)}/JobBoard/${ref.site.toLowerCase()}`;
};

/** The board's opportunities, or those its search box finds for `QueryString`, up to `max`. */
async function list(ref: CompanyRef, http: Ctx["http"], QueryString: string, max: number) {
  const url = `${board(ref)}/JobBoardView/LoadSearchResults`;
  const out: UkgOpportunity[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let skip = 0; skip < max; skip += PAGE) {
    const page = await http.postJson<{ opportunities?: UkgOpportunity[]; totalCount?: number }>(url, { opportunitySearch: { Top: PAGE, Skip: skip, ...(QueryString ? { QueryString } : {}) } });
    if (!Array.isArray(page.opportunities)) throw new Error("unexpected UKG response: no opportunities array");
    const fresh = page.opportunities.filter((o) => !seen.has(o.Id));
    for (const o of fresh) seen.add(o.Id);
    out.push(...fresh);
    total = page.totalCount ?? 0;
    if (!fresh.length || out.length >= total) break;
  }
  return { out, total };
}

export const ukg: Connector<UkgOpportunity> = {
  ats: "ukg",

  detect(url) {
    const host = url.hostname.toLowerCase();
    if (!HOST.test(host)) return null;
    // /{company code}/JobBoard/{board GUID}[/OpportunityDetail?…]
    const parts = url.pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => p.toLowerCase() === "jobboard");
    const code = i > 0 ? parts[i - 1] : undefined;
    const guid = i >= 0 ? parts[i + 1] : undefined;
    return code && guid && GUID.test(guid) ? { ats: "ukg", slug: code, shard: host, site: guid.toLowerCase() } : null;
  },

  async fetch(ref, { http, partial }) {
    const { out, total } = await list(ref, http, "", MAX_POSTINGS);
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    return (await list(ref, http, term, SEARCH_MAX_POSTINGS)).out;
  },

  async describe(raw, ref, { http }) {
    const html = await http.getText(`${board(ref)}/OpportunityDetail?opportunityId=${raw.Id}`);
    return htmlToText(jsonAfter<{ Description?: string }>(html, "CandidateOpportunityDetail(")?.Description ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    const places = (raw.Locations ?? []).map((l) => {
      const a = l.Address ?? {};
      return joinParts(a.City, a.State?.Code || a.State?.Name, a.Country?.Code === "USA" ? undefined : a.Country?.Name) || l.LocalizedName || "";
    });
    const workplace = LOCATION_TYPE[raw.JobLocationType ?? 0];
    const location = joinParts([...new Set(places.filter(Boolean))].join("; "), workplace === "remote" ? "Remote" : undefined);
    const country = raw.Locations?.[0]?.Address?.Country?.Name;
    return {
      id: jobId("ukg", ref.slug, raw.Id),
      ats: "ukg",
      company: ref.name,
      title: raw.Title.trim(),
      location,
      country: country || undefined,
      workplace: workplace ?? inferWorkplace(location),
      department: raw.JobCategoryName || undefined,
      postedAt: raw.PostedDate,
      url: `${board(ref)}/OpportunityDetail?opportunityId=${raw.Id}`,
      employmentType: employmentType(raw.FullTime === undefined ? undefined : raw.FullTime ? "full-time" : "part-time"),
      // The list only has a brief; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
