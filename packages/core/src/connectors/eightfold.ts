import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { HttpError } from "../http";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/**
 * Eightfold AI careers sites, used by large employers: {tenant}.eightfold.ai or the company's own
 * host (explore.jobs.netflix.net). Kept as slug = host, shard = the tenant's registered domain
 * (netflix.com), which every API call needs and is read from the careers page when a list
 * doesn't give it. Tenants answer on one of two public APIs: the newer "pcsx" search (details
 * per position) or the older v2 list (descriptions included); pcsx says 403 when a tenant is v2.
 */
export type EightfoldJob = {
  id: number;
  name: string;
  locations?: string[];
  department?: string;
  workLocationOption?: string;
  postedTs?: number;
  url?: string;
  /** v2 lists include it; pcsx needs describe(). */
  description?: string;
  api: "pcsx" | "v2";
  domain: string;
};

type Pcsx = { data?: { count?: number; positions?: { id: number; name: string; locations?: string[]; department?: string; workLocationOption?: string; postedTs?: number; positionUrl?: string }[] } };
type V2 = {
  count?: number;
  positions?: { id: number; name: string; locations?: string[]; department?: string; work_location_option?: string; t_create?: number; canonicalPositionUrl?: string; job_description?: string }[];
};

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
/** Both APIs return 10 positions a page whatever is asked. */
const PAGE = 10;
/** Beyond this we stop paging (100 requests). */
const MAX_POSTINGS = 1000;
const WORKPLACE: Record<string, Workplace> = { onsite: "onsite", remote: "remote", hybrid: "hybrid" };

/** The tenant's domain: from `shard`, else from the careers page (it names it in its API links). */
async function tenantDomain(ref: { slug: string; shard?: string }, http: Ctx["http"]): Promise<string> {
  if (ref.shard && DOMAIN.test(ref.shard)) return ref.shard.toLowerCase();
  // The page's settings are HTML-escaped JSON: {&#34;domain&#34;: &#34;netflix.com&#34;, …}
  const html = (await http.getText(`https://${ref.slug}/careers`)).replace(/&#34;|&quot;/g, '"');
  const domain = html.match(/[?&]domain=([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] ?? html.match(/"domain"\s*:\s*"([a-z0-9.-]+\.[a-z]{2,})"/i)?.[1];
  if (!domain) throw new Error(`Eightfold careers site "${ref.slug}" not found (no tenant domain on its page)`);
  return domain.toLowerCase();
}

const isForbidden = (err: unknown) => err instanceof HttpError && err.status === 403;

/** The tenant's positions, or those matching `query`, up to `max`. */
async function list(ref: CompanyRef, http: Ctx["http"], query: string, max: number) {
  if (!HOST.test(ref.slug)) throw new Error(`Eightfold careers site should be a host name, got "${ref.slug}"`);
  const host = ref.slug.toLowerCase();
  const domain = await tenantDomain(ref, http);
  const q = (start: number) => `domain=${encodeURIComponent(domain)}&start=${start}${query ? `&query=${encodeURIComponent(query)}` : ""}`;
  const pcsx = async (start: number): Promise<{ total: number; jobs: EightfoldJob[] }> => {
    const page = await http.getJson<Pcsx>(`https://${host}/api/pcsx/search?${q(start)}`);
    const jobs = (page.data?.positions ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      locations: p.locations,
      department: p.department,
      workLocationOption: p.workLocationOption,
      postedTs: p.postedTs,
      url: p.positionUrl ? `https://${host}${p.positionUrl}` : undefined,
      api: "pcsx" as const,
      domain,
    }));
    return { total: page.data?.count ?? 0, jobs };
  };
  const v2 = async (start: number): Promise<{ total: number; jobs: EightfoldJob[] }> => {
    const page = await http.getJson<V2>(`https://${host}/api/apply/v2/jobs?${q(start)}`);
    const jobs = (page.positions ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      locations: p.locations,
      department: p.department,
      workLocationOption: p.work_location_option,
      postedTs: p.t_create,
      url: p.canonicalPositionUrl,
      description: p.job_description,
      api: "v2" as const,
      domain,
    }));
    return { total: page.count ?? 0, jobs };
  };
  // "PCSX is not enabled for this user" (403): this tenant serves the v2 API instead.
  let read = pcsx;
  let page = await pcsx(0).catch((err) => {
    if (!isForbidden(err)) throw err;
    read = v2;
    return v2(0);
  });
  const out = [...page.jobs];
  const total = page.total;
  for (let start = PAGE; page.jobs.length && start < Math.min(total, max); start += PAGE) {
    try {
      page = await read(start);
    } catch (err) {
      // Refused partway (a rate limit on busy IPs, such as CI runners): keep what was read; the board is partial.
      if (!isForbidden(err)) throw err;
      return { out, total, cut: true };
    }
    out.push(...page.jobs);
  }
  return { out, total: page.total, cut: false };
}

export const eightfold: Connector<EightfoldJob> = {
  ats: "eightfold",

  detect(url) {
    const host = url.hostname.toLowerCase();
    // {tenant}.eightfold.ai/careers…; companies' own hosts are added by link via their careers page.
    if (!/^[a-z0-9-]+\.eightfold\.ai$/.test(host) || host.startsWith("www.") || host.startsWith("app.")) return null;
    const domain = url.searchParams.get("domain");
    return { ats: "eightfold", slug: host, ...(domain && DOMAIN.test(domain) ? { shard: domain.toLowerCase() } : {}) };
  },

  async fetch(ref, { http, partial }) {
    const { out, total, cut } = await list(ref, http, "", MAX_POSTINGS);
    // Refused partway, or stopped at the cap (or the API stopped early) well short of the total it reports.
    if (cut || total - out.length >= PAGE) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    return (await list(ref, http, term, SEARCH_MAX_POSTINGS)).out;
  },

  async describe(raw, ref, { http }) {
    if (raw.description) return htmlToText(raw.description);
    // Some v2 tenants (Netflix) leave it out of the list; the single-job call has it.
    if (raw.api === "v2") {
      const d = await http.getJson<{ job_description?: string }>(`https://${ref.slug.toLowerCase()}/api/apply/v2/jobs/${raw.id}?domain=${encodeURIComponent(raw.domain)}`);
      return htmlToText(d.job_description ?? "");
    }
    const d = await http.getJson<{ data?: { jobDescription?: string } }>(
      `https://${ref.slug.toLowerCase()}/api/pcsx/position_details?position_id=${raw.id}&domain=${encodeURIComponent(raw.domain)}&hl=en`,
    );
    return htmlToText(d.data?.jobDescription ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    // "Bruchsal,Baden-Württemberg,Germany" -> "Bruchsal, Baden-Württemberg, Germany"
    const places = [
      ...new Set(
        (raw.locations ?? []).map((l) =>
          l
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
            .join(", "),
        ),
      ),
    ];
    const workplace = WORKPLACE[(raw.workLocationOption ?? "").toLowerCase()];
    const location = places.join("; ") || (workplace === "remote" ? "Remote" : "");
    const country = raw.locations?.[0]?.split(",").at(-1)?.trim();
    return {
      id: jobId("eightfold", ref.slug, String(raw.id)),
      ats: "eightfold",
      company: ref.name,
      title: raw.name.trim(),
      location,
      country: country || undefined,
      workplace: workplace ?? inferWorkplace(location),
      department: raw.department || undefined,
      postedAt: raw.postedTs ? new Date(raw.postedTs * 1000).toISOString() : undefined,
      url: raw.url ?? `https://${ref.slug.toLowerCase()}/careers/job/${raw.id}`,
      // v2 lists carry it (describe() returns it without a request); pcsx needs describe().
      description: "",
    };
  },
};
