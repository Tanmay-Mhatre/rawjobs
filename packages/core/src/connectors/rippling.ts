import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText } from "../text";
import { detectAs, isoDate, joinParts } from "./parse";
import { jobId, type Connector } from "./types";

/** ats.rippling.com's board API, as its careers pages use it (no descriptions in the list). */
export type RipplingJob = {
  id: string;
  name: string;
  url: string;
  department?: { name?: string } | null;
  locations?: { name?: string; city?: string; state?: string; country?: string; workplaceType?: string }[];
};

type Page = { items?: RipplingJob[]; totalPages?: number };
type Detail = { description?: { company?: string; role?: string }; createdOn?: string };

const API = "https://ats.rippling.com/api/v2/board";
const PAGE = 50;
const MAX_PAGES = 40;

const WORKPLACE: Record<string, Workplace> = { REMOTE: "remote", HYBRID: "hybrid", ON_SITE: "onsite" };

export const rippling: Connector<RipplingJob> = {
  ats: "rippling",
  detect: detectAs("rippling"),

  async fetch(ref, { http, partial }) {
    const out: RipplingJob[] = [];
    let pages = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await http.getJson<Page>(`${API}/${encodeURIComponent(ref.slug)}/jobs?page=${page}&pageSize=${PAGE}`);
      if (!Array.isArray(data.items)) throw new Error("unexpected Rippling response: no items array");
      out.push(...data.items);
      pages = data.totalPages ?? 0;
      if (page + 1 >= (data.totalPages ?? 0) || data.items.length === 0) break;
    }
    // The board has more pages than we read.
    if (pages > MAX_PAGES) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const places = raw.locations ?? [];
    const kinds = new Set(places.map((l) => WORKPLACE[l.workplaceType ?? ""]).filter(Boolean));
    const workplace: Workplace = kinds.size === 1 ? [...kinds][0]! : kinds.has("remote") ? "remote" : "unknown";
    const location = [...new Set(places.map((l) => (l.workplaceType === "REMOTE" ? joinParts(l.name, "Remote") : (l.name ?? joinParts(l.city, l.state, l.country)))))].join("; ");
    return {
      id: jobId("rippling", ref.slug, raw.id),
      ats: "rippling",
      company: ref.name,
      title: raw.name.trim(),
      location,
      country: places[0]?.country,
      workplace,
      department: raw.department?.name,
      url: raw.url,
      description: "",
    };
  },

  async describe(raw, ref, { http }) {
    const d = await http.getJson<Detail>(`${API}/${encodeURIComponent(ref.slug)}/jobs/${encodeURIComponent(raw.id)}`);
    return { description: [htmlToText(d.description?.role), htmlToText(d.description?.company)].filter(Boolean).join("\n\n"), postedAt: isoDate(d.createdOn) };
  },
};
