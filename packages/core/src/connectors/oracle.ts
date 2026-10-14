import type { CompanyRef, NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { countryName, detectAs, isoDate } from "./parse";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/** Oracle Recruiting Cloud's candidate-experience REST API (what its careers sites call), keyless. */
export type OracleRequisition = {
  Id: string;
  Title: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  WorkplaceType?: string;
  WorkplaceTypeCode?: string;
  Department?: string | null;
  JobFamily?: string | null;
  ShortDescriptionStr?: string;
  secondaryLocations?: { Name?: string }[];
};

type Page = { items?: { TotalJobsCount?: number; requisitionList?: OracleRequisition[] }[] };
type Detail = { items?: { ExternalDescriptionStr?: string; ExternalResponsibilitiesStr?: string; ExternalQualificationsStr?: string; CorporateDescriptionStr?: string }[] };

const PAGE = 200;
const MAX_POSTINGS = 2000;

const WORKPLACE: Record<string, Workplace> = { ORA_ON_SITE: "onsite", ORA_HYBRID: "hybrid", ORA_REMOTE: "remote" };

const base = (ref: { slug: string; shard?: string }) => `https://${ref.slug}.fa.${ref.shard}.oraclecloud.com`;
/** Most companies have one external site, "CX_1"; others name theirs (CX_2, CX_1001…). */
const siteOf = (ref: { site?: string }) => ref.site || "CX_1";

/** The site's requisitions, or those matching `keyword`, up to `max`. */
async function list(ref: CompanyRef, http: Ctx["http"], keyword: string, max: number) {
  if (!ref.shard) throw new Error('oracle needs "shard" (the data centre, e.g. "ocs") from the careers URL');
  // The finder is "name;key=value,key=value": a keyword can't carry its separators or quotes.
  const kw = keyword.replace(/[",;\s]+/g, " ").trim();
  const out: OracleRequisition[] = [];
  let total = 0;
  for (let offset = 0; offset < max; offset += PAGE) {
    const finder = `findReqs;siteNumber=${siteOf(ref)},${kw ? `keyword="${kw}",` : ""}limit=${PAGE},offset=${offset},sortBy=POSTING_DATES_DESC`;
    const data = await http.getJson<Page>(
      `${base(ref)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`,
    );
    const page = data.items?.[0];
    if (!page || !Array.isArray(page.requisitionList)) throw new Error("unexpected Oracle response: no requisitionList");
    out.push(...page.requisitionList);
    total = page.TotalJobsCount ?? 0;
    if (offset + PAGE >= (page.TotalJobsCount ?? 0) || page.requisitionList.length === 0) break;
  }
  return { out, total };
}

export const oracle: Connector<OracleRequisition> = {
  ats: "oracle",
  detect: detectAs("oracle"),

  async fetch(ref, { http, partial }) {
    const { out, total } = await list(ref, http, "", MAX_POSTINGS);
    // Stopped at the cap (or the API stopped early) well short of the total it reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    return (await list(ref, http, term, SEARCH_MAX_POSTINGS)).out;
  },

  normalize(raw, ref): NormalizedJob {
    const location = [raw.PrimaryLocation, ...(raw.secondaryLocations ?? []).map((l) => l.Name)].filter((l): l is string => !!l).join("; ");
    return {
      id: jobId("oracle", ref.slug, raw.Id),
      ats: "oracle",
      company: ref.name,
      title: raw.Title.trim(),
      location,
      country: countryName(raw.PrimaryLocationCountry),
      workplace: WORKPLACE[raw.WorkplaceTypeCode ?? ""] ?? inferWorkplace(`${location} ${raw.WorkplaceType ?? ""}`),
      department: raw.Department ?? raw.JobFamily ?? undefined,
      postedAt: isoDate(raw.PostedDate),
      url: `${base(ref)}/hcmUI/CandidateExperience/en/sites/${siteOf(ref)}/job/${raw.Id}`,
      description: "",
    };
  },

  async describe(raw, ref, { http }) {
    const finder = `ById;Id="${raw.Id}",siteNumber=${siteOf(ref)}`;
    const d = (await http.getJson<Detail>(`${base(ref)}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${encodeURIComponent(finder)}`)).items?.[0] ?? {};
    return [d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].map(htmlToText).filter(Boolean).join("\n\n");
  },
};
