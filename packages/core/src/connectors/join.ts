import type { NormalizedJob, Workplace } from "../schema";
import { jobId, type Connector } from "./types";

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

/** The numeric company id the API needs: from `shard`, else from the careers page's embedded data. */
async function companyId(ref: { slug: string; shard?: string }, http: { getText(url: string): Promise<string> }): Promise<string> {
  if (ref.shard && /^\d+$/.test(ref.shard)) return ref.shard;
  const html = await http.getText(`https://join.com/companies/${encodeURIComponent(ref.slug)}`);
  const id = html.match(/"company":\{"id":(\d+)/)?.[1];
  if (!id) throw new Error(`JOIN company "${ref.slug}" not found`);
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

  async fetch(ref, { http }) {
    const id = await companyId(ref, http);
    const out: JoinJob[] = [];
    for (let page = 1, pages = 1; page <= pages && out.length < MAX_POSTINGS; page++) {
      const res = await http.getJson<Page>(`${API}/companies/${id}/jobs?page=${page}&pageSize=${PAGE}`);
      if (!Array.isArray(res.items)) throw new Error("unexpected JOIN response: no items array");
      out.push(...res.items);
      pages = res.pagination?.pageCount ?? 1;
      if (!res.items.length) break;
    }
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
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
