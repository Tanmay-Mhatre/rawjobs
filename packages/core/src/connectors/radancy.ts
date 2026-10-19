import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { inlineText, isoDate, jobPostingLd, ldLocation, xmlAll } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Radancy (TalentBrew) careers sites, on the companies' own domains (jobs.boeing.com,
 * www.disneycareers.com), keyed by that host. robots.txt closes their /search-jobs/ list, but
 * /sitemap.xml names every open job as /{lang?}/job/{city}/{title}/{org}/{id}: the list is read from
 * there in one request (titles and cities read off the URL), and a job's own page (JSON-LD, or the
 * TalentBrew description block) gives its full place, date and description for the jobs that pass
 * the title gate.
 */
export type RadancyJob = { id: string; title: string; city: string; url: string };

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const JOB_PATH = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/job\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/?$/i;
/** A sitemap index points at these many child sitemaps at most. */
const MAX_SITEMAPS = 10;

const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const words = (slug: string) =>
  decoded(slug)
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

/** The jobs a TalentBrew sitemap lists, read off their URLs. */
export function parseRadancySitemap(xml: string, host: string): RadancyJob[] {
  const out = new Map<string, RadancyJob>();
  for (const loc of xmlAll(xml, "loc")) {
    let u: URL;
    try {
      u = new URL(loc);
    } catch {
      continue;
    }
    const m = u.hostname.toLowerCase() === host.toLowerCase() ? u.pathname.match(JOB_PATH) : null;
    if (m && !out.has(m[4]!)) out.set(m[4]!, { id: m[4]!, title: words(m[2]!), city: words(m[1]!), url: u.href });
  }
  return [...out.values()];
}

async function sitemap(host: string, http: Ctx["http"]): Promise<string[]> {
  const url = `https://${host}/sitemap.xml`;
  if (!(await robotsAllows(http, url))) throw new Error(`robots.txt asks us not to read ${host}/sitemap.xml`);
  const xml = await http.getText(url);
  if (!/<sitemapindex[\s>]/.test(xml)) return [xml];
  const children = xmlAll(xml, "loc")
    .filter((l) => l.startsWith(`https://${host}/`))
    .slice(0, MAX_SITEMAPS);
  return Promise.all(children.map((c) => http.getText(c)));
}

/** A TalentBrew site lists its jobs in its sitemap: how a site on any domain proves it is one. */
export async function isRadancySite(host: string, http: Ctx["http"]): Promise<boolean> {
  if (!HOST.test(host)) return false;
  const xmls = await sitemap(host, http);
  return xmls.some((x) => parseRadancySitemap(x, host).length > 0);
}

export const radancy: Connector<RadancyJob> = {
  ats: "radancy",
  // Radancy sites live on the companies' own domains: found by Add by link's probe and the lists.
  detect: () => null,

  async fetch(ref, { http }) {
    if (!HOST.test(ref.slug)) throw new Error(`Radancy careers site should be a host name, got "${ref.slug}"`);
    const host = ref.slug.toLowerCase();
    const jobs = new Map<string, RadancyJob>();
    for (const xml of await sitemap(host, http)) for (const j of parseRadancySitemap(xml, host)) jobs.set(j.id, j);
    if (!jobs.size) throw new Error(`${host} is not a Radancy careers site (no jobs in its sitemap)`);
    return [...jobs.values()];
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("radancy", ref.slug, raw.id),
      ats: "radancy",
      company: ref.name,
      title: raw.title,
      location: raw.city,
      workplace: inferWorkplace(`${raw.city} ${raw.title}`),
      url: raw.url,
      description: "",
    };
  },

  // The sitemap gives only the city; the job's page has the full place.
  vagueLocation: () => true,

  async describe(raw, _ref, { http }) {
    const html = await http.getText(raw.url);
    const ld = jobPostingLd(html);
    if (!ld) {
      // No JSON-LD (Disney): TalentBrew's own description block and its analytics attributes.
      const start = html.indexOf('class="ats-description"');
      const end = start < 0 ? -1 : html.indexOf("</section>", start);
      const location = inlineText(html.match(/data-tm-job-location="([^"]*)"/)?.[1]).replace(/\s*,\s*/g, ", ");
      const date = html.match(/data-tm-job-date-posted=['"](\d{1,2})\/(\d{1,2})\/(\d{4})['"]/);
      return {
        description: start < 0 ? "" : htmlToText(`<div ${html.slice(start, end < 0 ? start + 30000 : end)}`),
        ...(location ? { location } : {}),
        ...(date ? { postedAt: isoDate(`${date[3]}-${date[1]!.padStart(2, "0")}-${date[2]!.padStart(2, "0")}`) } : {}),
      };
    }
    const location = ldLocation(ld);
    const remote = /telecommute/i.test(ld.jobLocationType ?? "");
    return {
      description: htmlToText(ld.description ?? ""),
      ...(location ? { location } : {}),
      ...(remote ? { workplace: "remote" as const } : {}),
      ...(isoDate(ld.datePosted) ? { postedAt: isoDate(ld.datePosted) } : {}),
    };
  },
};
