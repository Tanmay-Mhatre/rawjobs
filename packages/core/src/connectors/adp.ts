import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { joinParts } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * ADP Workforce Now career centers. A company's board is
 * workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid={cid}&ccId={ccId}, kept
 * as slug = cid, site = ccId. Its public staffing API lists requisitions (keyless JSON, the
 * board page's own calls); each requisition's description comes from its single-item call.
 */
export type AdpRequisition = {
  itemID: string;
  requisitionTitle: string;
  postDate?: string;
  requisitionLocations?: { address?: { cityName?: string; countrySubdivisionLevel1?: { codeValue?: string }; country?: { codeValue?: string } }; nameCode?: { shortName?: string } }[];
  organizationalUnits?: { nameCode?: { shortName?: string } }[];
};

const API = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";
const CID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CCID = /^[0-9A-Za-z_]+$/;
const PAGE = 50;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;

const query = (ref: { slug: string; site?: string }) => {
  if (!CID.test(ref.slug) || !ref.site || !CCID.test(ref.site)) throw new Error('ADP boards need the "cid" and "ccId" from the careers URL');
  return `cid=${ref.slug.toLowerCase()}&ccId=${ref.site}&lang=en_US&locale=en_US`;
};

export const adp: Connector<AdpRequisition> = {
  ats: "adp",

  detect(url) {
    if (url.hostname.toLowerCase() !== "workforcenow.adp.com") return null;
    const cid = url.searchParams.get("cid");
    const ccId = url.searchParams.get("ccId");
    return cid && CID.test(cid) && ccId && CCID.test(ccId) ? { ats: "adp", slug: cid.toLowerCase(), site: ccId } : null;
  },

  async fetch(ref, { http, partial }) {
    const out: AdpRequisition[] = [];
    let total = 0;
    for (let skip = 0; skip < MAX_POSTINGS; skip += PAGE) {
      const page = await http.getJson<{ jobRequisitions?: AdpRequisition[]; meta?: { totalNumber?: number } }>(`${API}?${query(ref)}&%24top=${PAGE}&%24skip=${skip}`);
      if (!Array.isArray(page.jobRequisitions)) throw new Error("unexpected ADP response: no jobRequisitions");
      out.push(...page.jobRequisitions);
      total = page.meta?.totalNumber ?? 0;
      if (page.jobRequisitions.length < PAGE || out.length >= total) break;
    }
    // Stopped at the cap well short of the total the board reports.
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  async describe(raw, ref, { http }) {
    const d = await http.getJson<{ requisitionDescription?: string }>(`${API}/${encodeURIComponent(raw.itemID)}?${query(ref)}`);
    return htmlToText(d.requisitionDescription ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    const places = [
      ...new Set(
        (raw.requisitionLocations ?? []).map((l) => {
          const a = l.address ?? {};
          return joinParts(a.cityName, a.countrySubdivisionLevel1?.codeValue) || (l.nameCode?.shortName ?? "").trim();
        }),
      ),
    ].filter(Boolean);
    const location = places.join("; ");
    return {
      id: jobId("adp", ref.slug, raw.itemID),
      ats: "adp",
      company: ref.name,
      title: raw.requisitionTitle.trim(),
      location,
      workplace: inferWorkplace(location),
      department: raw.organizationalUnits?.[0]?.nameCode?.shortName?.trim() || undefined,
      postedAt: raw.postDate ? new Date(raw.postDate).toISOString() : undefined,
      url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${ref.slug.toLowerCase()}&ccId=${ref.site}&jobId=${encodeURIComponent(raw.itemID)}&lang=en_US`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
