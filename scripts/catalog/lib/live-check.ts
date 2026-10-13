/** The cheapest live check each hiring system offers for one board (shared by check.ts and contributions). */
import { getConnector, HttpError, type AtsType, type HttpClient } from "@rawjobs/core";

export type Board = { key: string; ats: string; slug: string; region?: string; shard?: string; site?: string };
/** `titles`: job titles the check read anyway (systems with no cheap count), at most MAX_TITLES distinct ones. */
export type CheckResult = { status: "live" | "dormant" | "dead" | "error"; jobs: number | null; name?: string; http?: number; error?: string; titles?: string[] };

const enc = encodeURIComponent;

/** Enough titles to tell a company's industry, few enough to keep the saved state small. */
export const MAX_TITLES = 60;

/** Distinct job titles (ignoring case and spacing), first seen first, at most MAX_TITLES. */
export function titlesOf(titles: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    const title = t?.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push(title);
    if (out.length >= MAX_TITLES) break;
  }
  return out;
}

export async function checkBoard(http: HttpClient, b: Board): Promise<CheckResult> {
  try {
    switch (b.ats) {
      case "greenhouse": {
        const d = await http.getJson<{ jobs?: { company_name?: string }[] }>(`https://boards-api.greenhouse.io/v1/boards/${enc(b.slug)}/jobs`);
        const n = d.jobs?.length ?? 0;
        return { status: n ? "live" : "dormant", jobs: n, name: d.jobs?.[0]?.company_name };
      }
      case "lever": {
        const host = b.region === "eu" ? "https://api.eu.lever.co" : "https://api.lever.co";
        const d = await http.getJson<unknown>(`${host}/v0/postings/${enc(b.slug)}?mode=json&limit=1`);
        if (!Array.isArray(d)) return { status: "dead", jobs: null };
        return { status: d.length ? "live" : "dormant", jobs: null };
      }
      case "ashby": {
        const d = await http.getJson<{ jobs?: { isListed?: boolean }[] }>(`https://api.ashbyhq.com/posting-api/job-board/${enc(b.slug)}`);
        if (!Array.isArray(d.jobs)) return { status: "dead", jobs: null };
        const n = d.jobs.filter((j) => j.isListed !== false).length;
        return { status: n ? "live" : "dormant", jobs: n };
      }
      case "smartrecruiters": {
        const d = await http.getJson<{ totalFound: number; content: { company?: { name?: string } }[] }>(`https://api.smartrecruiters.com/v1/companies/${enc(b.slug)}/postings?limit=1`);
        // Unknown ids answer 200 with totalFound 0: indistinguishable from dormant, so call it dead.
        return d.totalFound ? { status: "live", jobs: d.totalFound, name: d.content[0]?.company?.name } : { status: "dead", jobs: 0 };
      }
      case "workday": {
        const d = await http.postJson<{ total?: number }>(`https://${b.slug}.${b.shard}.myworkdayjobs.com/wday/cxs/${enc(b.slug)}/${enc(b.site!)}/jobs`, {
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText: "",
        });
        const n = d.total ?? 0;
        return { status: n ? "live" : "dormant", jobs: n };
      }
      default: {
        // The rest have no cheap count: one full list (one request for most of them).
        const connector = getConnector(b.ats as AtsType);
        if (!connector) return { status: "error", jobs: null, error: "unknown ats" };
        const ref = {
          name: b.slug,
          ats: b.ats as AtsType,
          slug: b.slug,
          enabled: true,
          ...(b.region ? { region: b.region as "eu" } : {}),
          ...(b.shard ? { shard: b.shard } : {}),
          ...(b.site ? { site: b.site } : {}),
        };
        const raws = await connector.fetch(ref, { http, now: new Date() });
        const n = raws.length;
        // Gem answers any made-up board with an empty list, like SmartRecruiters: empty means dead.
        if (!n && b.ats === "gem") return { status: "dead", jobs: 0 };
        // The list is already here: keep its titles for industry tags (publish.ts), so systems the
        // job index doesn't read get tagged without another request.
        const titles = titlesOf(
          raws.slice(0, 500).map((r) => {
            try {
              return connector.normalize(r, ref).title;
            } catch {
              return undefined;
            }
          }),
        );
        return { status: n ? "live" : "dormant", jobs: n, ...(titles.length ? { titles } : {}) };
      }
    }
  } catch (err) {
    if (err instanceof HttpError && err.status && [404, 410, 422].includes(err.status)) return { status: "dead", jobs: null, http: err.status };
    // Page-read connectors say so when the page has no board ("…not found…", "not a job portal").
    if (!(err instanceof HttpError) && /not found|not an? (job|careers|rss)/i.test((err as Error).message)) return { status: "dead", jobs: null };
    const e = err as HttpError;
    return { status: "error", jobs: null, http: e.status, error: e.message.slice(0, 120) };
  }
}
