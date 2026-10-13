import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, relativePosted } from "./parse";
import { jobCompanyKey, workdayJobKey, type Connector } from "./types";

/** The careers site's own JSON API (/wday/cxs/{tenant}/{site}/jobs), keyless. */
export type WorkdayPosting = {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  remoteType?: string;
  bulletFields?: string[];
  /** Filled in by fetch() from postedOn ("Posted 3 Days Ago"), which needs the run's clock. */
  postedAt?: string;
};

type Page = { total?: number; jobPostings?: WorkdayPosting[] };
type Detail = {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    remoteType?: string;
    country?: { descriptor?: string };
  };
};

/** Workday caps a page at 20. */
const PAGE = 20;
/** Big employers list thousands of jobs; beyond this we stop paging. */
const MAX_POSTINGS = 2000;

const WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", onsite: "onsite", "on-site": "onsite", "on site": "onsite" };

const host = (ref: { slug: string; shard?: string }) => `https://${ref.slug}.${ref.shard}.myworkdayjobs.com`;
const api = (ref: { slug: string; shard?: string; site?: string }) => `${host(ref)}/wday/cxs/${encodeURIComponent(ref.slug)}/${encodeURIComponent(ref.site ?? "")}`;

export const workday: Connector<WorkdayPosting> = {
  ats: "workday",
  detect: detectAs("workday"),

  async fetch(ref, { http, now, partial }) {
    if (!ref.shard || !ref.site) throw new Error('workday needs "shard" and "site" from the careers URL');
    const out: WorkdayPosting[] = [];
    let total = Infinity;
    for (let offset = 0; offset < Math.min(total, MAX_POSTINGS); offset += PAGE) {
      const page = await http.postJson<Page>(`${api(ref)}/jobs`, { appliedFacets: {}, limit: PAGE, offset, searchText: "" });
      if (!Array.isArray(page.jobPostings)) throw new Error("unexpected Workday response: no jobPostings array");
      // Only the first page carries the total; later pages say 0.
      if (offset === 0) total = page.total ?? 0;
      out.push(...page.jobPostings.map((p) => ({ ...p, postedAt: relativePosted(p.postedOn, now) })));
      if (page.jobPostings.length < PAGE) break;
    }
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const location = raw.locationsText ?? "";
    return {
      id: `${jobCompanyKey(ref)}:${workdayJobKey(raw.externalPath)}`,
      ats: "workday",
      company: ref.name,
      title: raw.title.trim(),
      location,
      workplace: WORKPLACE[raw.remoteType?.toLowerCase() ?? ""] ?? inferWorkplace(location),
      postedAt: raw.postedAt,
      url: `${host(ref)}/${ref.site}${raw.externalPath}`,
      description: "",
    };
  },

  vagueLocation: (raw) => /^\d+ locations?$/i.test(raw.locationsText?.trim() ?? ""),

  async describe(raw, ref, { http }) {
    const d = (await http.getJson<Detail>(`${api(ref)}${raw.externalPath}`)).jobPostingInfo ?? {};
    const locations = [d.location, ...(d.additionalLocations ?? [])].filter((l): l is string => !!l);
    return {
      description: htmlToText(d.jobDescription),
      location: locations.length ? [...new Set(locations)].join("; ") : undefined,
      country: d.country?.descriptor,
      postedAt: raw.postedAt ?? isoDate(d.startDate),
    };
  },
};
