import { HttpError } from "../http";
import type { CompanyRef, NormalizedJob } from "../schema";
import { inferWorkplace } from "../text";
import { countryName, joinParts } from "./parse";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/**
 * Dayforce (formerly Ceridian) career sites, all on jobs.dayforcehcm.com/{culture}/{tenant}/{site}.
 * Kept as slug = tenant, site = the board code, shard = the culture when it isn't en-US. The
 * site's own page lists jobs through POST /api/geo/{tenant}/jobposting/search, 25 at a time,
 * descriptions included; like the page, each search carries the anonymous CSRF pair that
 * /api/auth/csrf hands every visitor (a cookie, and its token echoed in a header).
 */
export type DayforceJob = {
  jobPostingId: number;
  jobTitle: string;
  jobDescription?: string;
  postingStartTimestampUTC?: string;
  hasVirtualLocation?: boolean;
  postingLocations?: { cityName?: string; stateCode?: string; isoCountryCode?: string }[] | null;
};

const BASE = "https://jobs.dayforcehcm.com";
const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const CULTURE = /^[a-z]{2}-[A-Z]{2}$/;
/** Fixed by the platform: the request carries only an offset. */
const PAGE = 25;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;

const culture = (ref: { shard?: string }) => (ref.shard && CULTURE.test(ref.shard) ? ref.shard : "en-US");

type Pair = { cookie: string; token: string };

/**
 * One CSRF pair serves every board (it names no tenant; probed 2026-10-22: two tenants, and again 90 s
 * later). Kept per client for PAIR_MS, under its Cloudflare cookie's ~30 min life, so a crawl of
 * thousands of boards asks for a few pairs, not one per board.
 */
const PAIR_MS = 10 * 60_000;
const pairs = new WeakMap<Ctx["http"], { at: number; pair: Promise<Pair> }>();

function sharedCsrf(http: Ctx["http"], fresh = false): Promise<Pair> {
  const kept = pairs.get(http);
  if (!fresh && kept && Date.now() - kept.at < PAIR_MS) return kept.pair;
  const pair = csrf(http);
  pairs.set(http, { at: Date.now(), pair });
  // A failed fetch isn't kept: the next board asks again.
  pair.catch(() => pairs.get(http)?.pair === pair && pairs.delete(http));
  return pair;
}

/** A search refused for its CSRF pair (stale or rejected), so a new pair may get through. */
const refusedPair = (err: unknown) => err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 419);

/** The anonymous CSRF pair every visitor gets: the cookie to send back, and its token for the header. */
async function csrf(http: Ctx["http"]): Promise<Pair> {
  const { res, body } = await http.requestBody(`${BASE}/api/auth/csrf`, { headers: { accept: "application/json" } });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const token = (JSON.parse(body) as { csrfToken?: string }).csrfToken;
  if (!token || !cookie) throw new Error("unexpected Dayforce response: no CSRF token");
  return { cookie, token };
}

/** The board's postings, or those its search finds for `searchText`, up to `max`. */
async function list(ref: CompanyRef, http: Ctx["http"], searchText: string, max: number) {
  if (!NAME.test(ref.slug) || !ref.site || !NAME.test(ref.site)) throw new Error('Dayforce boards need the tenant and "site" (the board code) from the careers URL');
  let pair = await sharedCsrf(http);
  let renewed = false;
  const search = (start: number) =>
    http.requestBody(`${BASE}/api/geo/${encodeURIComponent(ref.slug)}/jobposting/search`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", cookie: pair.cookie, "x-csrf-token": pair.token },
      body: JSON.stringify({ clientNamespace: ref.slug, jobBoardCode: ref.site, cultureCode: culture(ref), paginationStart: start, ...(searchText ? { searchText } : {}) }),
    });
  const out: DayforceJob[] = [];
  let total = 0;
  for (let start = 0; start < max; start += PAGE) {
    const { body } = await search(start).catch(async (err: unknown) => {
      // Once per board: a refused pair is replaced for every board, and this page asked again.
      if (renewed || !refusedPair(err)) throw err;
      renewed = true;
      pair = await sharedCsrf(http, true);
      return search(start);
    });
    const page = JSON.parse(body) as { jobPostings?: DayforceJob[]; maxCount?: number };
    if (!Array.isArray(page.jobPostings)) throw new Error("unexpected Dayforce response: no jobPostings");
    out.push(...page.jobPostings);
    total = page.maxCount ?? 0;
    if (!page.jobPostings.length || out.length >= total) break;
  }
  return { out, total };
}

export const dayforce: Connector<DayforceJob> = {
  ats: "dayforce",

  detect(url) {
    if (url.hostname.toLowerCase() !== "jobs.dayforcehcm.com") return null;
    // /{culture}/{tenant}/{site}[/jobs/{id}]
    const [c, tenant, site] = url.pathname.split("/").filter(Boolean);
    if (!c || !CULTURE.test(c) || !tenant || !site || !NAME.test(tenant) || !NAME.test(site) || tenant === "api") return null;
    return { ats: "dayforce", slug: tenant.toLowerCase(), site: site.toLowerCase(), ...(c !== "en-US" ? { shard: c } : {}) };
  },

  async fetch(ref, { http, partial }) {
    const { out, total } = await list(ref, http, "", MAX_POSTINGS);
    // Stopped at the cap well short of the total the site reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    return (await list(ref, http, term, SEARCH_MAX_POSTINGS)).out;
  },

  normalize(raw, ref): NormalizedJob {
    const places = [
      ...new Set((raw.postingLocations ?? []).map((l) => joinParts(l.cityName, l.stateCode, l.isoCountryCode && l.isoCountryCode !== "US" ? countryName(l.isoCountryCode) : undefined))),
    ].filter(Boolean);
    const location = joinParts(places.join("; "), raw.hasVirtualLocation ? "Remote" : undefined);
    const code = raw.postingLocations?.[0]?.isoCountryCode;
    return {
      id: jobId("dayforce", ref.slug, String(raw.jobPostingId)),
      ats: "dayforce",
      company: ref.name,
      title: raw.jobTitle.trim(),
      location,
      country: code ? countryName(code) : undefined,
      workplace: raw.hasVirtualLocation ? "remote" : inferWorkplace(location),
      postedAt: raw.postingStartTimestampUTC ? new Date(raw.postingStartTimestampUTC).toISOString() : undefined,
      url: `${BASE}/${culture(ref)}/${ref.slug}/${ref.site}/jobs/${raw.jobPostingId}`,
      // Plain text already.
      description: (raw.jobDescription ?? "").trim(),
    };
  },
};
