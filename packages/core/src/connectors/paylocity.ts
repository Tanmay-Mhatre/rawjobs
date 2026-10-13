import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { countryName, jobPostingLd, joinParts, jsonAfter } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Paylocity, payroll and HR for US small and mid-size employers. Each company's careers page is
 * recruiting.paylocity.com/Recruiting/Jobs/All/{company GUID}: the page embeds every open job in
 * `window.pageData`; each job's full description is on its detail page, as JSON-LD.
 */
export type PaylocityJob = {
  JobId: number;
  JobTitle: string;
  LocationName?: string;
  PublishedDate?: string;
  IsRemote?: boolean;
  HiringDepartment?: string;
  JobLocation?: { City?: string; State?: string; Country?: string } | null;
};

const BASE = "https://recruiting.paylocity.com/Recruiting/Jobs";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const paylocity: Connector<PaylocityJob> = {
  ats: "paylocity",

  detect(url) {
    if (url.hostname.toLowerCase() !== "recruiting.paylocity.com") return null;
    // /Recruiting/Jobs/All/{guid}[/…]; the GUID is the company.
    const guid = url.pathname.split("/").find((p) => GUID.test(p));
    return guid ? { ats: "paylocity", slug: guid.toLowerCase() } : null;
  },

  async fetch(ref, { http }) {
    if (!GUID.test(ref.slug)) throw new Error(`Paylocity company id should be a GUID, got "${ref.slug}"`);
    const html = await http.getText(`${BASE}/All/${ref.slug}`);
    const data = jsonAfter<{ Jobs?: PaylocityJob[] }>(html, "window.pageData = ");
    if (!data || !Array.isArray(data.Jobs)) throw new Error(`Paylocity company "${ref.slug}" not found (its careers page has no job list)`);
    return data.Jobs;
  },

  async describe(raw, _ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${BASE}/Details/${raw.JobId}`));
    return htmlToText(ld?.description ?? "");
  },

  normalize(raw, ref): NormalizedJob {
    const l = raw.JobLocation ?? {};
    const country = l.Country === "USA" ? "United States" : countryName(l.Country);
    const place = joinParts(l.City, l.State) || raw.LocationName || "";
    const location = joinParts(place, raw.IsRemote ? "Remote" : undefined);
    return {
      id: jobId("paylocity", ref.slug, String(raw.JobId)),
      ats: "paylocity",
      company: ref.name,
      title: raw.JobTitle.trim(),
      location,
      country,
      workplace: raw.IsRemote ? "remote" : inferWorkplace(location),
      department: raw.HiringDepartment || undefined,
      postedAt: raw.PublishedDate ? new Date(raw.PublishedDate).toISOString() : undefined,
      url: `${BASE}/Details/${raw.JobId}`,
      // The list only has a preview; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
