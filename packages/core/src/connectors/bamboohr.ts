import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { HttpError } from "../http";
import { BoardClosedError, detectAs, isoDate, joinParts } from "./parse";
import { jobId, type Connector } from "./types";

/** {company}.bamboohr.com/careers/list: the careers page's own JSON (no descriptions). */
export type BambooJob = {
  id: string;
  jobOpeningName: string;
  departmentLabel?: string | null;
  location?: { city?: string | null; state?: string | null } | null;
  atsLocation?: { country?: string | null; state?: string | null; province?: string | null; city?: string | null } | null;
  isRemote?: boolean | null;
  /** "0" on-site, "1" remote, "2" hybrid. */
  locationType?: string | null;
};

type Detail = { result?: { jobOpening?: { description?: string; datePosted?: string; location?: { addressCountry?: string | null } } } };

export const bamboohr: Connector<BambooJob> = {
  ats: "bamboohr",
  detect: detectAs("bamboohr"),

  async fetch(ref, { http }) {
    let res: Response;
    try {
      res = await http.request(`https://${ref.slug}.bamboohr.com/careers/list`, { headers: { accept: "application/json" } });
    } catch (err) {
      // The account exists but its careers page is switched off (the page sends you to the login).
      if (err instanceof HttpError && err.status === 401) throw new BoardClosedError("BambooHR", ref.slug, "has its careers page switched off");
      throw err;
    }
    const body = await res.text();
    let data: { result?: BambooJob[] };
    try {
      data = JSON.parse(body) as { result?: BambooJob[] };
    } catch {
      // A web page instead of the list: BambooHR's home page (no such account) or the login page.
      const to = res.url ? new URL(res.url) : undefined;
      if (to?.hostname === "www.bamboohr.com" || to?.hostname === "bamboohr.com") throw new BoardClosedError("BambooHR", ref.slug, "no longer exists");
      if (to?.pathname.startsWith("/login")) throw new BoardClosedError("BambooHR", ref.slug, "has its careers page switched off");
      throw new Error(`unexpected BambooHR response: not JSON (${res.url || "no URL"})`);
    }
    if (!Array.isArray(data.result)) throw new Error("unexpected BambooHR response: no result array");
    return data.result;
  },

  normalize(raw, ref): NormalizedJob {
    const a = raw.atsLocation ?? {};
    const l = raw.location ?? {};
    const remote = raw.isRemote === true || raw.locationType === "1";
    const location = joinParts(a.city ?? l.city, a.state ?? a.province ?? l.state, a.country, remote ? "Remote" : undefined);
    return {
      id: jobId("bamboohr", ref.slug, raw.id),
      ats: "bamboohr",
      company: ref.name,
      title: raw.jobOpeningName.trim(),
      location,
      country: a.country ?? undefined,
      workplace: remote ? "remote" : raw.locationType === "2" ? "hybrid" : raw.locationType === "0" ? "onsite" : inferWorkplace(location),
      department: raw.departmentLabel ?? undefined,
      url: `https://${ref.slug}.bamboohr.com/careers/${raw.id}`,
      description: "",
    };
  },

  async describe(raw, ref, { http }) {
    const d = (await http.getJson<Detail>(`https://${ref.slug}.bamboohr.com/careers/${encodeURIComponent(raw.id)}/detail`)).result?.jobOpening ?? {};
    return { description: htmlToText(d.description), postedAt: isoDate(d.datePosted), country: d.location?.addressCountry ?? undefined };
  },
};
