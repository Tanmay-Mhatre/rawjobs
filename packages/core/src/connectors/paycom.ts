import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { isoDate } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Paycom, payroll and HR for US employers. A company's careers portal is
 * paycomonline.net/v4/ats/web.php/portal/{32-hex client key}/career-page. The portal page hands
 * every visitor an anonymous session token and names its applicant-tracking API host; with that
 * token (the same calls the portal makes in a browser) the API lists postings and serves each one.
 */
export type PaycomJob = {
  jobId: number;
  jobTitle: string;
  positionType?: string;
  remoteType?: string;
  locations?: string;
  /** From the portal page, so describe() can ask for the full posting in the same scan. */
  session: { api: string; token: string };
};

type Search = { jobPostingPreviews?: Omit<PaycomJob, "session">[]; jobPostingPreviewsCount?: number };
type Posting = { jobPosting?: { description?: string; qualifications?: string; startDate?: string } };

const PORTAL = "https://www.paycomonline.net/v4/ats/web.php/portal";
const KEY = /^[0-9a-f]{32}$/i;
const PAGE = 50;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;

const WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };

/** The portal's anonymous session: the token its own page uses and the API host it talks to. */
async function session(key: string, http: Ctx["http"]): Promise<PaycomJob["session"]> {
  const page = await http.getText(`${PORTAL}/${key}/jobs/1`);
  const token = page.match(/"sessionJWT":"([^"]+)"/)?.[1];
  const host = page.match(/portal-applicant-tracking\.[a-z0-9-]+\.paycomonline\.net/)?.[0];
  if (!token || !host) throw new Error(`Paycom portal "${key}" not found (no job portal on that page)`);
  return { api: `https://${host}/api/ats`, token };
}

const headers = (s: PaycomJob["session"]) => ({ accept: "application/json", "content-type": "application/json", authorization: s.token, locale: "en-US" });

async function json<T>(http: Ctx["http"], url: string, init: RequestInit): Promise<T> {
  const res = await http.request(url, init);
  return (await res.json()) as T;
}

export const paycom: Connector<PaycomJob> = {
  ats: "paycom",

  detect(url) {
    if (!/(^|\.)paycomonline\.net$/i.test(url.hostname)) return null;
    // …/portal/{key}/career-page, …/portal/{key}/jobs/{id}
    const parts = url.pathname.split("/");
    const key = parts[parts.indexOf("portal") + 1];
    return parts.includes("portal") && key && KEY.test(key) ? { ats: "paycom", slug: key.toLowerCase() } : null;
  },

  async fetch(ref, { http }) {
    if (!KEY.test(ref.slug)) throw new Error(`Paycom client key should be 32 hex characters, got "${ref.slug}"`);
    const s = await session(ref.slug, http);
    const out: PaycomJob[] = [];
    const seen = new Set<number>();
    for (let skip = 0; skip < MAX_POSTINGS; skip += PAGE) {
      const body = {
        skip,
        take: PAGE,
        filtersForQuery: {
          distanceFrom: 0,
          workEnvironments: [],
          positionTypes: [],
          educationLevels: [],
          categories: [],
          travelTypes: [],
          shiftTypes: [],
          otherFilters: [],
          keywordSearchText: "",
          location: "",
          sortOption: "",
        },
      };
      const page = await json<Search>(http, `${s.api}/job-posting-previews/search`, { method: "POST", headers: headers(s), body: JSON.stringify(body) });
      if (!Array.isArray(page.jobPostingPreviews)) throw new Error("unexpected Paycom response: no jobPostingPreviews");
      const fresh = page.jobPostingPreviews.filter((j) => !seen.has(j.jobId));
      for (const j of fresh) {
        seen.add(j.jobId);
        out.push({ ...j, session: s });
      }
      if (!fresh.length || out.length >= (page.jobPostingPreviewsCount ?? 0)) break;
    }
    return out;
  },

  async describe(raw, _ref, { http }) {
    const p = (await json<Posting>(http, `${raw.session.api}/job-postings/${raw.jobId}`, { headers: headers(raw.session) })).jobPosting ?? {};
    const description = [p.description, p.qualifications]
      .map((s) => htmlToText(s ?? ""))
      .filter(Boolean)
      .join("\n\n");
    return { description, ...(p.startDate ? { postedAt: isoDate(p.startDate) } : {}) };
  },

  normalize(raw, ref): NormalizedJob {
    // "Site name - City, ST 12345; Other site - City, ST": keep the city parts.
    const location = (raw.locations ?? "")
      .split(";")
      .map((l) => l.trim().replace(/^.* - /, ""))
      .filter(Boolean)
      .join("; ");
    const workplace = WORKPLACE[(raw.remoteType ?? "").toLowerCase()] ?? inferWorkplace(location);
    return {
      id: jobId("paycom", ref.slug, String(raw.jobId)),
      ats: "paycom",
      company: ref.name,
      title: raw.jobTitle.trim(),
      location: workplace === "remote" && !/remote/i.test(location) ? [location, "Remote"].filter(Boolean).join(", ") : location,
      workplace,
      url: `${PORTAL}/${ref.slug}/jobs/${raw.jobId}`,
      // The list has a teaser only; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
