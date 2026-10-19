import { employmentType } from "../catalog/employment";
import type { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { CompanyRef, NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, joinParts } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Bullhorn, the staffing agencies' system. Its open-source career portal runs on any host and reads
 * {host}/app.json for the agency's corpToken and swimlane, kept as slug = corpToken,
 * shard = swimlane and site = the portal's host when known. The jobs come from Bullhorn's public
 * REST search, public-rest{swimlane}.bullhornstaffing.com/rest-services/{token}/search/JobOrder,
 * with descriptions, 500 a page by start. Those hosts have no robots.txt; a wrong token answers 400.
 */
export type BullhornJob = {
  id: number;
  title: string;
  publishedCategory?: { id?: number; name?: string } | null;
  address?: { city?: string | null; state?: string | null; zip?: string | null; countryName?: string | null } | null;
  employmentType?: string | null;
  /** Epoch milliseconds. */
  dateLastPublished?: number | null;
  publicDescription?: string | null;
};

const TOKEN = /^[a-z0-9]+$/i;
const SWIMLANE = /^\d+$/;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const PAGE = 500;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 5000;
const FIELDS = "id,title,publishedCategory(id,name),address(city,state,zip,countryName),employmentType,dateLastPublished,publicDescription";

const restBase = (ref: Pick<CompanyRef, "slug" | "shard">) => {
  if (!TOKEN.test(ref.slug)) throw new Error(`Bullhorn corpToken should be letters and digits, got "${ref.slug}"`);
  if (!ref.shard || !SWIMLANE.test(ref.shard)) throw new Error(`Bullhorn companies need "shard" (the swimlane number from the portal's app.json), got "${ref.shard ?? ""}"`);
  return `https://public-rest${ref.shard}.bullhornstaffing.com/rest-services/${ref.slug}`;
};

/** A Bullhorn career portal's app.json names its corpToken and swimlane: how a site on any domain proves it is one. */
export async function bullhornFromPortal(host: string, http: Ctx["http"]): Promise<{ slug: string; shard: string } | null> {
  if (!HOST.test(host)) return null;
  const url = `https://${host.toLowerCase()}/app.json`;
  try {
    if (!(await robotsAllows(http, url))) return null;
    const app = await http.getJson<{ service?: { corpToken?: unknown; swimlane?: unknown } }>(url);
    const slug = String(app?.service?.corpToken ?? "");
    const shard = String(app?.service?.swimlane ?? "");
    return TOKEN.test(slug) && SWIMLANE.test(shard) ? { slug, shard } : null;
  } catch {
    return null;
  }
}

export const bullhorn: Connector<BullhornJob> = {
  ats: "bullhorn",

  detect(url) {
    const lane = url.hostname.toLowerCase().match(/^public-rest(\d+)\.bullhornstaffing\.com$/)?.[1];
    const [root, token] = url.pathname.split("/").filter(Boolean);
    return lane && root === "rest-services" && token && TOKEN.test(token) ? { ats: "bullhorn", slug: token, shard: lane } : null;
  },

  async fetch(ref, { http, partial }) {
    const base = restBase(ref);
    if (!(await robotsAllows(http, `${base}/search/JobOrder`))) throw new Error(`robots.txt asks us not to read ${new URL(base).host}`);
    const out: BullhornJob[] = [];
    let total = 0;
    for (let start = 0; start < MAX_POSTINGS; start += PAGE) {
      const url = `${base}/search/JobOrder?query=(isOpen:1)%20AND%20(isDeleted:0)&fields=${FIELDS}&count=${PAGE}&start=${start}&sort=-dateLastPublished`;
      let res: { total?: number; data?: BullhornJob[] };
      try {
        res = await http.getJson(url);
      } catch (err) {
        if ((err as HttpError).status === 400 && start === 0) throw new BoardClosedError("Bullhorn", ref.slug, "(Bullhorn doesn't know this corpToken)");
        throw err;
      }
      if (!Array.isArray(res.data)) throw new Error("unexpected Bullhorn response: no data array");
      total = res.total ?? 0;
      out.push(...res.data);
      if (res.data.length < PAGE || out.length >= total) break;
    }
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const a = raw.address ?? {};
    const country = a.countryName || undefined;
    const location = joinParts(a.city, a.state, country);
    // The portal's own page when we know its host, else the posting's public REST record.
    const url = ref.site && HOST.test(ref.site) ? `https://${ref.site}/#/jobs/${raw.id}` : `${restBase(ref)}/query/JobBoardPost?where=(id=${raw.id})&fields=${FIELDS}`;
    return {
      id: jobId("bullhorn", ref.slug, raw.id),
      ats: "bullhorn",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country,
      workplace: inferWorkplace(`${location} ${raw.title}`),
      department: raw.publishedCategory?.name || undefined,
      postedAt: raw.dateLastPublished ? new Date(raw.dateLastPublished).toISOString() : undefined,
      url,
      employmentType: employmentType(raw.employmentType),
      description: htmlToText(raw.publicDescription ?? ""),
    };
  },
};
