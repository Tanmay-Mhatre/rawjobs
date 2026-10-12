import type { NormalizedJob } from "../schema";
import { htmlToText } from "../text";
import { isoDate } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Remote OK's public API (https://remoteok.com/api). Its terms (the feed's first entry): link back to
 * Remote OK and name it as the source (each job's url is its Remote OK page and the board shows as
 * "Remote OK"); don't use its logo. The first entry is that notice, not a job.
 */
export type RemoteOkJob = {
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  date?: string;
  url?: string;
  salary_min?: number;
  salary_max?: number;
  legal?: string;
};

/** Some Remote OK text arrives UTF-8 encoded twice ("fÃ¼r"): undo that when it plainly happened. */
export function fixMojibake(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching Latin-1 bytes (mojibake) is the point
  if (!/[ÃÂ][\u0080-\u00BF]/.test(s) || /[^\u0000-\u00FF]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (ch) => ch.charCodeAt(0)));
  } catch {
    return s;
  }
}

export const remoteok: Connector<RemoteOkJob> = {
  ats: "remoteok",
  label: "Remote OK",
  minIntervalHours: 6,

  detect(url) {
    return /(^|\.)remoteok\.(com|io)$/i.test(url.hostname) ? { ats: "remoteok", slug: "all" } : null;
  },

  async fetch(_ref, { http }) {
    const data = await http.getJson<RemoteOkJob[]>("https://remoteok.com/api");
    if (!Array.isArray(data)) throw new Error("unexpected Remote OK response: not a list");
    return data.filter((j) => j.id !== undefined && j.position);
  },

  normalize(raw, ref): NormalizedJob {
    const where = raw.location?.trim();
    return {
      id: jobId("remoteok", ref.slug, raw.id!),
      ats: "remoteok",
      company: fixMojibake(raw.company?.trim() || "Remote OK"),
      title: fixMojibake(raw.position!.trim()),
      location: where ? `Remote (${fixMojibake(where)})` : "Remote",
      workplace: "remote",
      department: raw.tags?.[0],
      salary: raw.salary_min || raw.salary_max ? { min: raw.salary_min || undefined, max: raw.salary_max || undefined, currency: "USD", period: "year" } : undefined,
      postedAt: isoDate(raw.date),
      url: raw.url ?? `https://remoteok.com/remote-jobs/${raw.slug ?? raw.id}`,
      description: fixMojibake(htmlToText(raw.description)),
    };
  },
};
