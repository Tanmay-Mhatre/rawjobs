import { employmentType } from "../catalog/employment";
import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, joinParts } from "./parse";
import { jobId, salaryPeriod, type Connector } from "./types";

/** {company}.recruitee.com/api/offers/: the public careers-site feed, descriptions included. */
export type RecruiteeOffer = {
  id: number;
  title: string;
  slug?: string;
  careers_url?: string;
  department?: string | null;
  city?: string | null;
  state_name?: string | null;
  country?: string | null;
  location?: string | null;
  locations?: { city?: string; state?: string; country?: string; name?: string }[];
  remote?: boolean;
  hybrid?: boolean;
  employment_type_code?: string | null;
  on_site?: boolean;
  published_at?: string;
  created_at?: string;
  description?: string;
  requirements?: string | null;
  salary?: { min?: string | number | null; max?: string | number | null; currency?: string | null; period?: string | null };
};

const num = (v: string | number | null | undefined) => (v == null || v === "" ? undefined : Number(v) || undefined);

export const recruitee: Connector<RecruiteeOffer> = {
  ats: "recruitee",
  detect: detectAs("recruitee"),

  async fetch(ref, { http }) {
    const data = await http.getJson<{ offers?: RecruiteeOffer[] }>(`https://${ref.slug}.recruitee.com/api/offers/`);
    if (!Array.isArray(data.offers)) throw new Error("unexpected Recruitee response: no offers array");
    return data.offers;
  },

  normalize(raw, ref): NormalizedJob {
    const places = (raw.locations?.length ? raw.locations : [{ city: raw.city ?? undefined, state: raw.state_name ?? undefined, country: raw.country ?? undefined }])
      .map((l) => joinParts(l.city, l.state, l.country) || l.name || "")
      .filter(Boolean);
    const location = joinParts(places.join("; "), raw.remote ? "Remote" : undefined) || raw.location || "";
    const workplace: Workplace = raw.remote ? "remote" : raw.hybrid ? "hybrid" : raw.on_site ? "onsite" : inferWorkplace(location);
    const s = raw.salary;
    const min = num(s?.min);
    const max = num(s?.max);
    return {
      id: jobId("recruitee", ref.slug, raw.id),
      ats: "recruitee",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: raw.locations?.[0]?.country ?? raw.country ?? undefined,
      workplace,
      department: raw.department ?? undefined,
      salary: min || max ? { min, max, currency: s?.currency ?? undefined, period: salaryPeriod(s?.period) } : undefined,
      postedAt: isoDate(raw.published_at ?? raw.created_at),
      url: raw.careers_url ?? `https://${ref.slug}.recruitee.com/o/${raw.slug ?? raw.id}`,
      employmentType: employmentType(raw.employment_type_code),
      description: [htmlToText(raw.description), htmlToText(raw.requirements)].filter(Boolean).join("\n\n"),
    };
  },
};
