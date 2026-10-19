import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { inlineText } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Avature, the enterprise hiring system behind careers portals at {tenant}.avature.net/{portal}
 * (Bloomberg, Koch). Its RSS feed stops at 20 jobs, so the list is read from the portal's own search
 * pages, /{portal}/SearchJobs/?jobOffset=N, as many jobs a page as the portal shows (6 to 12). Kept as
 * slug = tenant, site = portal ("careers" when the link doesn't say). robots.txt closes only `qtvc=` links.
 */
export type AvatureJob = { id: string; title: string; location: string; url: string };

/** Beyond this many pages we stop: the rest of the list isn't gone, so the read counts as partial. */
const MAX_PAGES = 80;

const TENANT = /^[a-z0-9][a-z0-9-]*$/i;
const PORTAL = /^[A-Za-z0-9_-]+$/;
/** A locale segment some portals put before the portal name ("/en_US/careers/…"). */
const LOCALE = /^[a-z]{2}_[A-Z]{2}$/;

const base = (tenant: string, portal: string) => `https://${tenant.toLowerCase()}.avature.net/${portal}`;

/** The jobs on one search page: each JobDetail link, with the location shown under it (if any). */
export function parseAvaturePage(html: string): AvatureJob[] {
  const out = new Map<string, AvatureJob>();
  const links = [...html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+\/JobDetail\/[^"]*?\/(\d+))(?:[?#][^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi)];
  links.forEach((m, i) => {
    const id = m[2]!;
    const title = inlineText(m[3]);
    if (!title || out.has(id)) return;
    // The location sits between this link and the next job's.
    const end = links.slice(i + 1).find((n) => n[2] !== id)?.index ?? html.length;
    const loc = html.slice(m.index! + m[0].length, end).match(/class="list-item-location"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    out.set(id, { id, title, location: inlineText(loc), url: m[1]!.replace(/&amp;/g, "&") });
  });
  return [...out.values()];
}

export const avature: Connector<AvatureJob> = {
  ats: "avature",

  detect(url) {
    const tenant = url.hostname.toLowerCase().match(/^([a-z0-9-]+)\.avature\.net$/)?.[1];
    if (!tenant) return null;
    const segs = url.pathname.split("/").filter(Boolean);
    const portal = LOCALE.test(segs[0] ?? "") ? segs[1] : segs[0];
    return { ats: "avature", slug: tenant, ...(portal && PORTAL.test(portal) ? { site: portal } : {}) };
  },

  async fetch(ref, { http, partial }) {
    if (!TENANT.test(ref.slug)) throw new Error(`Avature tenant should be a short name, got "${ref.slug}"`);
    const portal = ref.site && PORTAL.test(ref.site) ? ref.site : "careers";
    const first = `${base(ref.slug, portal)}/SearchJobs/`;
    if (!(await robotsAllows(http, first))) throw new Error(`robots.txt asks us not to read ${ref.slug}.avature.net/${portal}`);
    const out = new Map<string, AvatureJob>();
    for (let p = 0, offset = 0; ; p++) {
      if (p === MAX_PAGES) {
        partial?.();
        break;
      }
      const html = await http.getText(`${first}?jobOffset=${offset}`);
      const before = out.size;
      for (const j of parseAvaturePage(html)) if (!out.has(j.id)) out.set(j.id, j);
      const added = out.size - before;
      if (!added) break;
      offset += added;
    }
    return [...out.values()];
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("avature", ref.slug, raw.id),
      ats: "avature",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      url: raw.url,
      description: "",
    };
  },

  // Some portals show no location in the list; the job's own page has it.
  vagueLocation: (raw) => !raw.location,

  async describe(raw, _ref, { http }) {
    const html = await http.getText(raw.url);
    const location = inlineText(html.match(/field__label[^>]*>\s*(?:Work\s+)?Location(?:s|\(s\))?\s*<\/[^>]+>\s*<div[^>]*field__value[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const start = html.indexOf('class="article__content');
    const body = start < 0 ? "" : html.slice(start, html.lastIndexOf("</article>") > start ? html.lastIndexOf("</article>") : undefined);
    return { description: htmlToText(`<div ${body}`), ...(location && !raw.location ? { location } : {}) };
  },
};
