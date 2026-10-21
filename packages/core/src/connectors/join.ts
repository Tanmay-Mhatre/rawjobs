import { employmentType } from "../catalog/employment";
import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { firstPageFingerprint, jobCompanyKey, jobId, type BoardIds, type Connector } from "./types";

/**
 * JOIN (join.com), big with small and mid-size employers in Germany, Austria and Switzerland.
 * Careers pages are join.com/companies/{slug}; the public API is keyed by the company's numeric
 * id, kept in `shard` when a list gives it, else read once from the careers page.
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

type Page = { items?: JoinJob[]; pagination?: { pageCount?: number; rowCount?: number } };

const API = "https://join.com/api/public";
/** JOIN refuses any larger page (HTTP 422). */
const PAGE = 5;
/** Beyond this we stop paging (a page holds only 5 jobs). */
const MAX_POSTINGS = 500;

const WORKPLACE: Record<string, Workplace> = { ONSITE: "onsite", HYBRID: "hybrid", REMOTE: "remote" };

/**
 * The numeric company id the API needs: from `shard`, else one learned before (ids), else from the
 * careers page's embedded data, which is then kept in ids so the next run skips that page.
 */
async function companyId(ref: CompanyRef, http: { getText(url: string): Promise<string> }, ids?: BoardIds): Promise<string> {
  if (ref.shard && /^\d+$/.test(ref.shard)) return ref.shard;
  const key = jobCompanyKey(ref);
  const known = ids?.get(key);
  if (known) return known;
  const html = await http.getText(`https://join.com/companies/${encodeURIComponent(ref.slug)}`);
  const id = html.match(/"company":\{"id":(\d+)/)?.[1];
  if (!id) throw new Error(`JOIN company "${ref.slug}" not found`);
  ids?.set(key, id);
  return id;
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

  async fetch(ref, { http, partial, firstPage, ids }) {
    const id = await companyId(ref, http, ids);
    const out: JoinJob[] = [];
    let total = 0;
    for (let page = 1, pages = 1; page <= pages && out.length < MAX_POSTINGS; page++) {
      const res = await http.getJson<Page>(`${API}/companies/${id}/jobs?page=${page}&pageSize=${PAGE}`);
      if (!Array.isArray(res.items)) throw new Error("unexpected JOIN response: no items array");
      out.push(...res.items);
      pages = res.pagination?.pageCount ?? 1;
      total = res.pagination?.rowCount ?? 0;
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

  async describe(raw, _ref, { http }) {
    const d = await http.getJson<{ description?: string }>(`${API}/jobs/${raw.id}`);
    // Markdown: keep the words, drop the markup.
    return (d.description ?? "")
      .replace(/[*_#>`]+/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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
