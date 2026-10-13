import type { NormalizedJob } from "../schema";
import { HttpError } from "../http";
import { htmlToText, inferWorkplace } from "../text";
import { type LdJobPosting, ldLocation } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * softgarden, hiring software big in Germany: careers sites at {account}.career.softgarden.de.
 * Each publishes /jobs.feed.json, a schema.org DataFeed of every active job ad as a JobPosting
 * (title, place, date, description): one request per company.
 */
export type SoftgardenPosting = LdJobPosting & { url?: string; identifier?: { value?: number | string } };

const ACCOUNT = /^[a-z0-9][a-z0-9-]*$/i;

export const softgarden: Connector<SoftgardenPosting> = {
  ats: "softgarden",

  detect(url) {
    const sub = url.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.career\.softgarden\.de$/)?.[1];
    return sub && sub !== "www" ? { ats: "softgarden", slug: sub } : null;
  },

  async fetch(ref, { http }) {
    if (!ACCOUNT.test(ref.slug)) throw new Error(`softgarden account should be a subdomain name, got "${ref.slug}"`);
    const feed = await http.getJson<{ dataFeedElement?: { item?: SoftgardenPosting }[] }>(`https://${ref.slug.toLowerCase()}.career.softgarden.de/jobs.feed.json`).catch((err) => {
      // An account softgarden doesn't know answers 400.
      if (err instanceof HttpError && err.status === 400) throw new Error(`softgarden careers site "${ref.slug}" not found`);
      throw err;
    });
    if (!Array.isArray(feed.dataFeedElement)) throw new Error(`softgarden careers site "${ref.slug}" not found (no job feed)`);
    return feed.dataFeedElement.map((e) => e.item).filter((i): i is SoftgardenPosting => !!i?.title);
  },

  normalize(raw, ref): NormalizedJob {
    const location = [ldLocation(raw), /telecommute|remote/i.test(raw.jobLocationType ?? "") ? "Remote" : undefined].filter(Boolean).join(", ");
    const id = raw.identifier?.value ?? raw.url?.match(/\/jobs\/(\d+)/)?.[1] ?? raw.url ?? raw.title;
    return {
      id: jobId("softgarden", ref.slug, String(id)),
      ats: "softgarden",
      company: ref.name,
      title: (raw.title ?? "").trim(),
      location,
      workplace: /telecommute/i.test(raw.jobLocationType ?? "") ? "remote" : inferWorkplace(location),
      postedAt: raw.datePosted ? new Date(raw.datePosted).toISOString() : undefined,
      url: raw.url ?? `https://${ref.slug.toLowerCase()}.career.softgarden.de/`,
      description: htmlToText(raw.description ?? ""),
    };
  },
};
