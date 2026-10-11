import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, countryName, detectAs, isoDate, joinParts } from "./parse";
import { jobId, type Connector } from "./types";

type Branch = { id: number; city?: string | null; state?: string | null; country_code?: string | null; location?: string | null };

/** {company}.freshteam.com/hire/widgets/jobs.json: the careers widget's feed, descriptions included. */
export type FreshteamJob = {
  id: number;
  title: string;
  description?: string;
  url: string;
  remote?: boolean;
  created_at?: string;
  branch_id?: number;
  job_role_id?: number;
  /** Joined in by fetch() from the feed's branches and job_roles lists. */
  branch?: Branch;
  role?: string;
};

type Feed = { jobs?: FreshteamJob[]; branches?: Branch[]; job_roles?: { id: number; name: string }[] };

export const freshteam: Connector<FreshteamJob> = {
  ats: "freshteam",
  detect: detectAs("freshteam"),

  async fetch(ref, { http }) {
    const body = await http.getText(`https://${ref.slug}.freshteam.com/hire/widgets/jobs.json`);
    let data: Feed;
    try {
      data = JSON.parse(body) as Feed;
    } catch {
      // Freshteam answers a web page for accounts that are gone or blocked (a lapsed subscription).
      if (/couldn.t find/i.test(body)) throw new BoardClosedError("Freshteam", ref.slug, "no longer exists");
      if (/account is blocked/i.test(body)) throw new BoardClosedError("Freshteam", ref.slug, "is blocked by Freshteam");
      throw new Error("unexpected Freshteam response: not JSON");
    }
    if (!Array.isArray(data.jobs)) throw new Error("unexpected Freshteam response: no jobs array");
    const branches = new Map((data.branches ?? []).map((b) => [b.id, b]));
    const roles = new Map((data.job_roles ?? []).map((r) => [r.id, r.name]));
    return data.jobs.map((j) => ({ ...j, branch: branches.get(j.branch_id ?? -1), role: roles.get(j.job_role_id ?? -1) }));
  },

  normalize(raw, ref): NormalizedJob {
    const b = raw.branch;
    const country = countryName(b?.country_code);
    const location = joinParts(b?.city, b?.state, country, raw.remote ? "Remote" : undefined) || b?.location || "";
    return {
      id: jobId("freshteam", ref.slug, raw.id),
      ats: "freshteam",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country,
      workplace: raw.remote ? "remote" : inferWorkplace(location),
      // "All Departments" is Freshteam's default role, not a department.
      department: raw.role && !/^all departments$/i.test(raw.role) ? raw.role : undefined,
      postedAt: isoDate(raw.created_at),
      url: raw.url,
      description: htmlToText(raw.description),
    };
  },
};
