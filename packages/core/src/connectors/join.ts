import { employmentType } from "../catalog/employment";
import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText } from "../text";
import { jsonAfter } from "./parse";
import { firstPageFingerprint, jobId, type Connector } from "./types";

/**
 * JOIN (join.com), big with small and mid-size employers in Germany, Austria and Switzerland.
 * Careers pages are join.com/companies/{slug}, five jobs a page (?page=2, …).
 */
export type JoinJob = {
  id: number;
  idParam: string;
  title: string;
  createdAt?: string;
  workplaceType?: string;
  city?: { cityName?: string; countryName?: string; regionName?: string };
  country?: { iso3166?: string; name?: string };
  category?: { name?: string };
  employmentType?: { name?: string };
};

type Page = { items?: JoinJob[]; pagination?: { pageCount?: number; total?: number } };
/** The data a join.com page embeds for its own rendering (Next.js). */
type PageData = { jobs?: Page; job?: { description?: string } };

/** A careers page lists 5 jobs and takes no larger page size. */
const PAGE = 5;
/** Beyond this we stop paging (a page holds only 5 jobs). */
const MAX_POSTINGS = 500;

const WORKPLACE: Record<string, Workplace> = { ONSITE: "onsite", HYBRID: "hybrid", REMOTE: "remote" };

const careersUrl = (slug: string) => `https://join.com/companies/${encodeURIComponent(slug)}`;

/**
 * The page's embedded data. JOIN closed its public API (/api/public answers 404 since 13 Nov 2026), so
 * the jobs, a page at a time, and each job's description come from the pages people see.
 */
function pageData(html: string): PageData | undefined {
  return jsonAfter<{ props?: { pageProps?: { pageData?: PageData } } }>(html, 'id="__NEXT_DATA__"')?.props?.pageProps?.pageData;
}

export const join: Connector<JoinJob> = {
  ats: "join",

  detect(url) {
    const host = url.hostname.toLowerCase();
    if (host !== "join.com" && host !== "www.join.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // join.com/companies/{slug}[/{job}]
    return parts[0] === "companies" && parts[1] && /^[a-z0-9][a-z0-9_-]*$/i.test(parts[1]) ? { ats: "join", slug: parts[1].toLowerCase() } : null;
  },

  async fetch(ref, { http, partial, firstPage }) {
    const out: JoinJob[] = [];
    let total = 0;
    for (let page = 1, pages = 1; page <= pages && out.length < MAX_POSTINGS; page++) {
      const html = await http.getText(page === 1 ? careersUrl(ref.slug) : `${careersUrl(ref.slug)}?page=${page}`);
      const res = pageData(html)?.jobs;
      if (!res) throw new Error(`JOIN company "${ref.slug}" not found`);
      if (!Array.isArray(res.items)) throw new Error("unexpected JOIN response: no items array");
      out.push(...res.items);
      pages = res.pagination?.pageCount ?? 1;
      total = res.pagination?.total ?? 0;
      // A board of several pages whose first is as the last full read saw it: that read's jobs stand.
      if (
        page === 1 &&
        pages > 1 &&
        firstPage?.(
          firstPageFingerprint(
            total,
            res.items.map((j) => String(j.id)),
          ),
          total,
        )
      )
        return out;
      if (!res.items.length) break;
    }
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async describe(raw, ref, { http }) {
    // The job's page (an old idParam redirects to the current one); its description is HTML.
    const html = await http.getText(`${careersUrl(ref.slug)}/${raw.idParam}`);
    return htmlToText(pageData(html)?.job?.description);
  },

  normalize(raw, ref): NormalizedJob {
    const country = raw.city?.countryName || raw.country?.name;
    const workplace = WORKPLACE[raw.workplaceType ?? ""] ?? "unknown";
    const location = [raw.city?.cityName, country, workplace === "remote" ? "Remote" : undefined].filter(Boolean).join(", ");
    return {
      id: jobId("join", ref.slug, String(raw.id)),
      ats: "join",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country,
      workplace,
      department: raw.category?.name,
      postedAt: raw.createdAt,
      url: `https://join.com/companies/${encodeURIComponent(ref.slug)}/${raw.idParam}`,
      employmentType: employmentType(raw.employmentType?.name),
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
