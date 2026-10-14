import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, openByStatus, relativePosted, urlOf } from "./parse";
import { firstPageFingerprint, jobCompanyKey, SEARCH_MAX_POSTINGS, workdayJobKey, type Connector, type Ctx } from "./types";

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

/**
 * The careers site's job list, or its search results for `searchText`, up to `max` postings. With
 * `firstPage`, a board whose first page is as the last full read saw it stops there (unchanged).
 */
async function list(ref: CompanyRef, { http, now }: Ctx, searchText: string, max: number, firstPage?: Ctx["firstPage"]) {
  if (!ref.shard || !ref.site) throw new Error('workday needs "shard" and "site" from the careers URL');
  const out: WorkdayPosting[] = [];
  let total = Infinity;
  for (let offset = 0; offset < Math.min(total, max); offset += PAGE) {
    const page = await http.postJson<Page>(`${api(ref)}/jobs`, { appliedFacets: {}, limit: PAGE, offset, searchText });
    if (!Array.isArray(page.jobPostings)) throw new Error("unexpected Workday response: no jobPostings array");
    out.push(...page.jobPostings.map((p) => ({ ...p, postedAt: relativePosted(p.postedOn, now) })));
    // Only the first page carries the total; later pages say 0.
    if (offset === 0) {
      total = page.total ?? 0;
      const ids = page.jobPostings.map((p) => (p.externalPath ? workdayJobKey(p.externalPath) : ""));
      // A one-page board costs the same either way: only longer ones are worth comparing.
      if (total > PAGE && firstPage?.(firstPageFingerprint(total, ids), total)) return { out, total, unchanged: true };
    }
    if (page.jobPostings.length < PAGE) break;
  }
  return { out, total, unchanged: false };
}

export const workday: Connector<WorkdayPosting> = {
  ats: "workday",
  detect: detectAs("workday"),

  async fetch(ref, ctx) {
    const { out, total, unchanged } = await list(ref, ctx, "", MAX_POSTINGS, ctx.firstPage);
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (!unchanged && total - out.length >= PAGE) ctx.partial?.();
    return out;
  },

  async search(ref, term, ctx) {
    return (await list(ref, ctx, term, SEARCH_MAX_POSTINGS)).out;
  },

  normalize(raw, ref): NormalizedJob {
    // Without its path a posting has no id or link (seen on some boards): it's left out, the rest still count.
    if (!raw.externalPath) throw new Error("Workday posting without a path");
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

  /**
   * The job's detail address (the one describe() reads) answers 200 while it's up. A 404 alone proves
   * nothing: a title edit moves the address and the job stays (seen 2026-10-14). So the board's search
   * is asked for the requisition number too: closed only when that finds nothing at all. Links are
   * {tenant}.wd5.myworkdayjobs.com/[en-US/]{site}/job/{place}/{title}_{req}.
   */
  async isOpen(job, { http }) {
    const url = urlOf(job.url);
    const board = url ? workday.detect(url) : null;
    const at = url?.pathname.indexOf("/job/") ?? -1;
    if (!board?.shard || !board.site || !url || at < 0) return undefined;
    const path = url.pathname.slice(at);
    const open = await openByStatus(http, `${api(board)}${path}`);
    if (open !== false) return open;
    const req = workdayJobKey(path);
    try {
      const page = await http.postJson<Page>(`${api(board)}/jobs`, { appliedFacets: {}, limit: PAGE, offset: 0, searchText: req });
      if (!Array.isArray(page.jobPostings)) return undefined;
      if (page.jobPostings.some((p) => workdayJobKey(p.externalPath) === req)) return true;
      return page.total === 0 && !page.jobPostings.length ? false : undefined;
    } catch {
      return undefined;
    }
  },
};
