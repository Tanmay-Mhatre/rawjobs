import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { inlineText } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Oleeo (formerly WCN), the hiring system of UK government departments and graduate schemes, at
 * {tenant}.tal.net. A board's vacancy list, /vx/lang-en-GB/candidate/jobboard/vacancy/{board}/adv/,
 * is a server table of 50 rows a page (?start=50 for the next) with title, location and closing
 * date, and "N Opportunities found" above it. A job's own page has the description (no JSON-LD).
 * Kept as slug = tenant, site = board number ("1" when the link doesn't say). robots.txt closes only
 * the /agent/, /ats/ and /channel/ areas but asks for a 10 s crawl delay, which the client doesn't
 * keep, so a read stops at MAX_PAGES.
 */
export type OleeoJob = { id: string; title: string; location: string; url: string };

/** 50 rows a page: past this many pages we stop, and the read counts as partial. */
const MAX_PAGES = 20;
const PAGE_SIZE = 50;

const TENANT = /^[a-z0-9][a-z0-9-]*$/i;
const BOARD = /^\d+$/;

const boardUrl = (tenant: string, board: string) => `https://${tenant.toLowerCase()}.tal.net/vx/lang-en-GB/candidate/jobboard/vacancy/${board}/adv/`;

/** The rows of one list page, and the total the page states. */
export function parseOleeoPage(html: string): { total: number; jobs: OleeoJob[] } {
  const jobs: OleeoJob[] = [];
  for (const m of html.matchAll(/<tr\b[^>]*class="opp_(\d+) search_res[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = m[2]!.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const cells = [...m[2]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => inlineText(c[1]));
    const title = inlineText(link?.[2]);
    if (link && title) jobs.push({ id: m[1]!, title, location: cells[1] ?? "", url: link[1]!.replace(/&amp;/g, "&") });
  }
  const total = Number(html.match(/(\d+)\s+Opportunit(?:y|ies) found/i)?.[1] ?? jobs.length);
  return { total, jobs };
}

export const oleeo: Connector<OleeoJob> = {
  ats: "oleeo",

  detect(url) {
    const tenant = url.hostname.toLowerCase().match(/^([a-z0-9-]+)\.tal\.net$/)?.[1];
    if (!tenant) return null;
    const board = url.pathname.match(/\/jobboard\/vacancy\/(\d+)\//)?.[1];
    return { ats: "oleeo", slug: tenant, ...(board ? { site: board } : {}) };
  },

  async fetch(ref, { http, partial }) {
    if (!TENANT.test(ref.slug)) throw new Error(`Oleeo tenant should be a short name, got "${ref.slug}"`);
    const first = boardUrl(ref.slug, ref.site && BOARD.test(ref.site) ? ref.site : "1");
    if (!(await robotsAllows(http, first))) throw new Error(`robots.txt asks us not to read ${ref.slug}.tal.net`);
    const out = new Map<string, OleeoJob>();
    for (let p = 0; ; p++) {
      if (p === MAX_PAGES) {
        partial?.();
        break;
      }
      const { total, jobs } = parseOleeoPage(await http.getText(p ? `${first}?start=${p * PAGE_SIZE}` : first));
      const before = out.size;
      for (const j of jobs) if (!out.has(j.id)) out.set(j.id, j);
      if (out.size === before || out.size >= total) break;
    }
    return [...out.values()];
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("oleeo", ref.slug, raw.id),
      ats: "oleeo",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      url: raw.url,
      description: "",
    };
  },

  // Some boards hide the location column; the job's page has it.
  vagueLocation: (raw) => !raw.location,

  async describe(raw, _ref, { http }) {
    const html = await http.getText(raw.url);
    const start = html.indexOf('class="form-view');
    const end = start < 0 ? -1 : html.indexOf("</form>", start);
    const location = inlineText(html.match(/hform_lbl_text"\s*>\s*Location[^<]*<\/span>[\s\S]*?class="form-control-static"[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    return {
      description: start < 0 ? "" : htmlToText(`<div ${html.slice(start, end < 0 ? undefined : end)}`),
      ...(location && !raw.location ? { location } : {}),
    };
  },
};
