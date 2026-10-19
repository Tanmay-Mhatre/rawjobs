import type { NormalizedJob } from "../schema";
import type { HttpError } from "../http";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, inlineText } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * ReachMee (Talentech), the hiring system of many Swedish employers and agencies. A careers page
 * embeds web103.reachmee.com/customerjs/{iid}-{customer}-{site}.js, which holds the site's
 * `validator`; the job list is the iframe page /ext/{iid}/{customer}/main?site={site}&validator=…,
 * a server table (#jobsTable) of every open job with title link (…job_id={n}), place (Ort) and
 * closing date, no paging. A job's page has the advert. Kept as slug = "{iid}-{customer}",
 * site = site number. web103 has no robots.txt (404: all allowed); the siteNNN.reachmee.com hosts
 * say Disallow: / and are never read.
 */
export type ReachMeeJob = { id: string; title: string; location: string; url: string };

const BASE = "https://web103.reachmee.com";
const SLUG = /^(I\d+)-(\d+)$/i;
const SITE = /^\d+$/;

/** The rows of #jobsTable: the place is the column headed Ort (or Location), else the second. */
export function parseReachMeeList(html: string): ReachMeeJob[] {
  const table = html.match(/<table\b[^>]*id='jobsTable'[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const heads = [...(table.match(/<thead>([\s\S]*?)<\/thead>/i)?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => inlineText(h[1]));
  const at = heads.findIndex((h) => /^(ort|location|plats|placering|kommun|stad)\b/i.test(h));
  const place = at < 0 ? 1 : at;
  const out = new Map<string, ReachMeeJob>();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = row[1]!.match(/<a\b[^>]*href='([^']*[?&]job_id=(\d+)[^']*)'[^>]*>([\s\S]*?)<\/a>/i);
    if (!link || out.has(link[2]!)) continue;
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => inlineText(c[1]));
    const title = inlineText(link[3]);
    if (title) out.set(link[2]!, { id: link[2]!, title, location: cells[place] ?? "", url: link[1]!.replace(/&amp;/g, "&") });
  }
  return [...out.values()];
}

export const reachmee: Connector<ReachMeeJob> = {
  ats: "reachmee",

  detect(url) {
    if (url.hostname.toLowerCase() !== "web103.reachmee.com") return null;
    const js = url.pathname.match(/^\/customerjs\/(I\d+)-(\d+)-(\d+)\.js$/i);
    if (js) return { ats: "reachmee", slug: `${js[1]!.toUpperCase()}-${js[2]}`, site: js[3]! };
    const ext = url.pathname.match(/^\/ext\/(I\d+)\/(\d+)\//i);
    const site = url.searchParams.get("site");
    return ext && site && SITE.test(site) ? { ats: "reachmee", slug: `${ext[1]!.toUpperCase()}-${ext[2]}`, site } : null;
  },

  async fetch(ref, { http }) {
    const m = ref.slug.match(SLUG);
    if (!m || !ref.site || !SITE.test(ref.site)) throw new Error(`ReachMee site should be "I021-1746" with a site number, got "${ref.slug}" / "${ref.site ?? ""}"`);
    const js = `${BASE}/customerjs/${m[1]!.toUpperCase()}-${m[2]}-${ref.site}.js`;
    if (!(await robotsAllows(http, js))) throw new Error("robots.txt asks us not to read web103.reachmee.com");
    let script: string;
    try {
      script = await http.getText(js);
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("ReachMee", ref.slug, "(no careers site)");
      throw err;
    }
    const validator = script.match(/var\s+validator\s*=\s*'([0-9a-f]+)'/i)?.[1];
    if (!validator) throw new BoardClosedError("ReachMee", ref.slug, "(no validator in its site script)");
    const lang = script.match(/var\s+langDef\s*=\s*'([A-Z]{2})'/i)?.[1] ?? "SE";
    const html = await http.getText(`${BASE}/ext/${m[1]!.toUpperCase()}/${m[2]}/main?site=${ref.site}&validator=${validator}&lang=${lang}`);
    if (!/id='jobsTable'/i.test(html)) throw new Error("unexpected ReachMee response: no job table");
    return parseReachMeeList(html);
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("reachmee", ref.slug, raw.id),
      ats: "reachmee",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      url: raw.url,
      description: "",
    };
  },

  // A site can leave out the place column; the job's page has it under the title.
  vagueLocation: (raw) => !raw.location,

  async describe(raw, _ref, { http }) {
    const html = await http.getText(raw.url);
    const start = html.indexOf('class="jobad-body"');
    const end = start < 0 ? -1 : html.indexOf('<p class="suffix-text"', start);
    const location = inlineText(html.match(/<p class="text-color-muted extid">([^<]+)<\/p>/)?.[1]);
    return {
      description: start < 0 ? "" : htmlToText(`<div ${html.slice(start, end < 0 ? undefined : end)}`),
      ...(location && !raw.location ? { location } : {}),
    };
  },
};
