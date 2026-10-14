import { employmentType } from "../catalog/employment";
import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { htmlToText } from "../text";
import { firstPathSegment, jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

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
  typeOfEmployment?: { id?: string; label?: string };
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

/** The company's postings, or those the API's full-text `q` finds, up to `max`. */
async function list(ref: CompanyRef, http: Ctx["http"], q: string, max: number) {
  const out: SmartRecruitersPosting[] = [];
  let total = 0;
  for (let offset = 0; offset < max; offset += PAGE) {
    const page = await http.getJson<Page>(`${API}/${encodeURIComponent(ref.slug)}/postings?limit=${PAGE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    if (!Array.isArray(page.content)) throw new Error("unexpected SmartRecruiters response: no content array");
    out.push(...page.content);
    total = page.totalFound;
    // An unknown company id answers 200 with totalFound 0, so an empty result is not proof the board exists.
    if (offset + PAGE >= page.totalFound || page.content.length === 0) break;
  }
  return { out, total };
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
    const { out, total } = await list(ref, http, "", MAX_POSTINGS);
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    // Unquoted, q matches any of the words ("software engineer" finds every engineer, in no useful
    // order); quoted, it matches the phrase.
    const words = term.replace(/"/g, " ").trim().replace(/\s+/g, " ");
    return (await list(ref, http, words.includes(" ") ? `"${words}"` : words, SEARCH_MAX_POSTINGS)).out;
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
      employmentType: employmentType(raw.typeOfEmployment?.label ?? raw.typeOfEmployment?.id),
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
};
