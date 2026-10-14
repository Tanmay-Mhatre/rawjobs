import { employmentType } from "../catalog/employment";
import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, joinParts } from "./parse";
import { jobId, type Connector } from "./types";

/** apply.workable.com's public widget feed: every published job with its description, one request. */
export type WorkableJob = {
  title: string;
  shortcode: string;
  telecommuting?: boolean;
  employment_type?: string | null;
  department?: string | null;
  url?: string;
  published_on?: string;
  created_at?: string;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  locations?: { country?: string; city?: string; region?: string; hidden?: boolean }[];
  description?: string;
};

export const workable: Connector<WorkableJob> = {
  ats: "workable",
  detect: detectAs("workable"),

  async fetch(ref, { http }) {
    const data = await http.getJson<{ jobs?: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(ref.slug)}?details=true`);
    if (!Array.isArray(data.jobs)) throw new Error("unexpected Workable response: no jobs array");
    return data.jobs;
  },

  normalize(raw, ref): NormalizedJob {
    const places = (raw.locations?.length ? raw.locations.filter((l) => !l.hidden) : [{ city: raw.city ?? undefined, region: raw.state ?? undefined, country: raw.country ?? undefined }])
      .map((l) => joinParts(l.city, l.region, l.country))
      .filter(Boolean);
    const location = joinParts(places.join("; "), raw.telecommuting ? "Remote" : undefined);
    return {
      id: jobId("workable", ref.slug, raw.shortcode),
      ats: "workable",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: raw.locations?.[0]?.country ?? raw.country ?? undefined,
      workplace: raw.telecommuting ? "remote" : inferWorkplace(location),
      department: raw.department ?? undefined,
      postedAt: isoDate(raw.published_on ?? raw.created_at),
      url: raw.url ?? `https://apply.workable.com/${ref.slug}/j/${raw.shortcode}/`,
      employmentType: employmentType(raw.employment_type),
      description: htmlToText(raw.description),
    };
  },
};
