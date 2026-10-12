import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, joinParts } from "./parse";
import { jobId, type Connector } from "./types";

/** A job opening as a Zoho Recruit careers page embeds it (hidden input id="jobs"), descriptions included. */
export type ZohoJob = {
  id: string;
  Posting_Title?: string;
  Job_Opening_Name?: string;
  City?: string;
  State?: string;
  Country?: string;
  Remote_Job?: boolean;
  Industry?: string;
  Job_Description?: string;
  Date_Opened?: string;
  Publish?: boolean;
};

/** The careers page name from its URL (/jobs/{page}); "Careers" is Zoho's default. */
const pageOf = (ref: { site?: string }) => ref.site || "Careers";

export function parseZohoPage(html: string): ZohoJob[] | undefined {
  const value = html.match(/<input[^>]*value="(\[[^"]*)"[^>]*id="jobs"/)?.[1] ?? html.match(/<input[^>]*id="jobs"[^>]*value="(\[[^"]*)"/)?.[1];
  if (!value) return undefined;
  try {
    return JSON.parse(decodeEntities(value)) as ZohoJob[];
  } catch {
    return undefined;
  }
}

const titleSlug = (t: string) =>
  t
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const zoho: Connector<ZohoJob> = {
  ats: "zoho",
  detect: detectAs("zoho"),

  async fetch(ref, { http }) {
    const html = await http.getText(`https://${ref.slug}.zohorecruit.com/jobs/${encodeURIComponent(pageOf(ref))}`);
    const jobs = parseZohoPage(html);
    if (!jobs) throw new Error(`Zoho Recruit careers page "${pageOf(ref)}" not found for ${ref.slug}`);
    return jobs.filter((j) => j.Publish !== false);
  },

  normalize(raw, ref): NormalizedJob {
    const title = (raw.Posting_Title || raw.Job_Opening_Name || "").trim();
    const location = joinParts(raw.City, raw.State, raw.Country, raw.Remote_Job ? "Remote" : undefined);
    return {
      id: jobId("zoho", ref.slug, raw.id),
      ats: "zoho",
      company: ref.name,
      title,
      location,
      country: raw.Country || undefined,
      workplace: raw.Remote_Job ? "remote" : inferWorkplace(location),
      postedAt: isoDate(raw.Date_Opened),
      url: `https://${ref.slug}.zohorecruit.com/jobs/${pageOf(ref)}/${raw.id}/${titleSlug(title)}`,
      description: htmlToText(raw.Job_Description),
    };
  },
};
