import { employmentType } from "../catalog/employment";
import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { openByStatus, urlOf } from "./parse";
import { firstPathSegment, jobId, salaryPeriod, type Connector } from "./types";

/** https://github.com/lever/postings-api */
export type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string | null;
  workplaceType?: "on-site" | "remote" | "hybrid" | "unspecified" | string;
  categories?: {
    location?: string;
    allLocations?: string[];
    department?: string;
    team?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
};

const API = { global: "https://api.lever.co", eu: "https://api.eu.lever.co" };

const WORKPLACE: Record<string, Workplace> = { "on-site": "onsite", remote: "remote", hybrid: "hybrid" };

export const lever: Connector<LeverPosting> = {
  ats: "lever",

  detect(url) {
    const host = url.hostname.toLowerCase();
    // API URL: api.lever.co/v0/postings/acme
    const api = host === "api.lever.co" || host === "api.eu.lever.co" ? url.pathname.match(/^\/v0\/postings\/([^/?]+)/) : null;
    if (api?.[1]) return { ats: "lever", slug: decodeURIComponent(api[1]), region: host === "api.eu.lever.co" ? "eu" : undefined };
    if (host !== "jobs.lever.co" && host !== "jobs.eu.lever.co") return null;
    const slug = firstPathSegment(url);
    // jobs.lever.co also serves its own images and assets; those paths aren't company boards.
    if (!slug || /^(img|images|static|assets|css|js|favicon.*|\d+)$/i.test(slug)) return null;
    return { ats: "lever", slug, region: host === "jobs.eu.lever.co" ? "eu" : undefined };
  },

  async fetch(ref, { http }) {
    const base = API[ref.region ?? "global"];
    const data = await http.getJson<LeverPosting[] | { ok: false; error: string }>(`${base}/v0/postings/${encodeURIComponent(ref.slug)}?mode=json`);
    if (!Array.isArray(data)) throw new Error(`unexpected Lever response: ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  },

  /** The posting's API address (on the board's region) answers 404 once it's taken down. Links are jobs.lever.co/acme/{id}[/apply]. */
  async isOpen(job, { http }) {
    const url = urlOf(job.url);
    const board = url ? lever.detect(url) : null;
    const id = url?.pathname.split("/").filter(Boolean)[1];
    // Only a board link says which region the posting lives in; the id alone would guess.
    if (!board || !url?.hostname.startsWith("jobs.") || !id || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    return openByStatus(http, `${API[board.region ?? "global"]}/v0/postings/${encodeURIComponent(board.slug)}/${id}`);
  },

  normalize(raw, ref): NormalizedJob {
    const c = raw.categories ?? {};
    const location = (c.allLocations?.length ? c.allLocations.join("; ") : c.location) ?? "";
    const description = [raw.descriptionPlain, ...(raw.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), raw.additionalPlain].filter(Boolean).join("\n\n").trim();
    const s = raw.salaryRange;
    return {
      id: jobId("lever", ref.slug, raw.id),
      ats: "lever",
      company: ref.name,
      title: raw.text.trim(),
      location,
      country: raw.country ?? undefined,
      workplace: WORKPLACE[raw.workplaceType ?? ""] ?? inferWorkplace(location),
      department: c.department ?? c.team,
      salary: s && (s.min || s.max) ? { min: s.min, max: s.max, currency: s.currency, period: salaryPeriod(s.interval) } : undefined,
      postedAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : undefined,
      url: raw.hostedUrl,
      employmentType: employmentType(raw.categories?.commitment),
      description,
    };
  },
};
