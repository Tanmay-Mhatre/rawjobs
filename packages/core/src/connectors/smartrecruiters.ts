import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText } from "../text";
import { HttpError } from "../http";
import { urlOf } from "./parse";
import { firstPathSegment, jobId, type Connector } from "./types";

/** https://developers.smartrecruiters.com/docs/posting-api (official, keyless for public postings) */
export type SmartRecruitersPosting = {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  department?: { label?: string };
  function?: { label?: string };
  customField?: { fieldLabel?: string; valueLabel?: string }[];
};

type Page = { totalFound: number; content: SmartRecruitersPosting[] };
type Detail = { jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };

const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE = 100;
/** Big employers list thousands of postings; beyond this we stop paging. */
const MAX_POSTINGS = 2000;

let regionNames: Intl.DisplayNames | undefined;
/** "ae" -> "United Arab Emirates", using the runtime's built-in country names. */
function countryName(code?: string): string | undefined {
  if (!code) return undefined;
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const smartrecruiters: Connector<SmartRecruitersPosting> = {
  ats: "smartrecruiters",

  detect(url) {
    const host = url.hostname.toLowerCase();
    if (host === "careers.smartrecruiters.com" || host === "jobs.smartrecruiters.com") {
      const slug = firstPathSegment(url);
      return slug ? { ats: "smartrecruiters", slug } : null;
    }
    const api = host === "api.smartrecruiters.com" ? url.pathname.match(/\/v1\/companies\/([^/]+)/) : null;
    return api?.[1] ? { ats: "smartrecruiters", slug: decodeURIComponent(api[1]) } : null;
  },

  async fetch(ref, { http, partial }) {
    const out: SmartRecruitersPosting[] = [];
    let total = 0;
    for (let offset = 0; offset < MAX_POSTINGS; offset += PAGE) {
      const page = await http.getJson<Page>(`${API}/${encodeURIComponent(ref.slug)}/postings?limit=${PAGE}&offset=${offset}`);
      if (!Array.isArray(page.content)) throw new Error("unexpected SmartRecruiters response: no content array");
      out.push(...page.content);
      total = page.totalFound;
      // An unknown company id answers 200 with totalFound 0, so an empty result is not proof the board exists.
      if (offset + PAGE >= page.totalFound || page.content.length === 0) break;
    }
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const l = raw.location ?? {};
    const country = countryName(l.country);
    const location = [l.city, l.region && l.region !== l.city ? l.region : undefined, country, l.remote ? "Remote" : undefined].filter(Boolean).join(", ");
    const workplace: Workplace = l.remote ? "remote" : l.hybrid ? "hybrid" : l.city || l.country ? "onsite" : "unknown";
    const company = raw.company?.identifier ?? ref.slug;
    return {
      id: jobId("smartrecruiters", ref.slug, raw.id),
      ats: "smartrecruiters",
      company: ref.name,
      title: raw.name.trim(),
      location,
      country,
      workplace,
      department: raw.department?.label || raw.function?.label,
      postedAt: raw.releasedDate,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${raw.id}`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },

  async describe(raw, ref, { http }) {
    const d = await http.getJson<Detail>(`${API}/${encodeURIComponent(ref.slug)}/postings/${encodeURIComponent(raw.id)}`);
    const sections = d.jobAd?.sections ?? {};
    return ["jobDescription", "qualifications", "additionalInformation", "companyDescription"]
      .map((k) => htmlToText(sections[k]?.text))
      .filter(Boolean)
      .join("\n\n");
  },

  /**
   * The posting's API address: a taken-down posting still answers 200 for a while, with "active": false
   * (checked 2026-10-14), and 404 once it's gone. Links are jobs.smartrecruiters.com/Acme/{id}[-title].
   */
  async isOpen(job, { http }) {
    const url = urlOf(job.url);
    const board = url ? smartrecruiters.detect(url) : null;
    const id = board ? url?.pathname.split("/").filter(Boolean)[1]?.match(/^\d+/)?.[0] : undefined;
    if (!board || !id) return undefined;
    try {
      const posting = await http.getJson<{ id?: string; active?: boolean }>(`${API}/${encodeURIComponent(board.slug)}/postings/${id}`);
      return posting.id === id && typeof posting.active === "boolean" ? posting.active : undefined;
    } catch (err) {
      return err instanceof HttpError && (err.status === 404 || err.status === 410) ? false : undefined;
    }
  },
};
