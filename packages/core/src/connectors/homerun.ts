import { employmentType } from "../catalog/employment";
import type { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, isoDate, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Homerun, a hiring tool for small European companies: careers pages at {slug}.homerun.co (or a
 * company domain whose page links rel="alternate" to the feed). The Atom feed feed.homerun.co/{slug}
 * lists every open job with place, type, department and full description in one request; an unknown
 * slug redirects to a 404. feed.homerun.co has no robots.txt; app.homerun.co (Disallow: /) is never read.
 */
export type HomerunJob = { id: string; title: string; link: string; updated: string; location: string; type: string; department: string; description: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/i;
/** Homerun's own hosts, not companies' pages. */
const NOT_BOARDS = new Set(["www", "app", "feed", "api", "cdn", "help", "404"]);

/** The <name> inside an entry's <location>, <type> or <department>. */
const named = (entry: string, tag: string) => xmlOne(xmlBlocks(entry, tag)[0] ?? "", "name");

export function parseHomerunFeed(xml: string): HomerunJob[] {
  return xmlBlocks(xml, "entry").map((e) => {
    const link = e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? "";
    return {
      id: xmlOne(e, "id") || link,
      title: xmlOne(e, "title"),
      link,
      updated: xmlOne(e, "updated"),
      location: named(e, "location"),
      type: named(e, "type"),
      department: named(e, "department"),
      description: xmlOne(e, "description") || xmlOne(e, "content"),
    };
  });
}

export const homerun: Connector<HomerunJob> = {
  ats: "homerun",

  detect(url) {
    const host = url.hostname.toLowerCase();
    if (host === "feed.homerun.co") {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      return slug && SLUG.test(slug) ? { ats: "homerun", slug: slug.toLowerCase() } : null;
    }
    const m = host.match(/^([a-z0-9-]+)\.homerun\.co$/);
    return m && !NOT_BOARDS.has(m[1]!) ? { ats: "homerun", slug: m[1]! } : null;
  },

  async fetch(ref, { http }) {
    if (!SLUG.test(ref.slug)) throw new Error(`Homerun board should be a short name, got "${ref.slug}"`);
    const url = `https://feed.homerun.co/${ref.slug.toLowerCase()}`;
    if (!(await robotsAllows(http, url))) throw new Error("robots.txt asks us not to read feed.homerun.co");
    let xml: string;
    try {
      xml = await http.getText(url);
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("Homerun", ref.slug, "(no careers page)");
      throw err;
    }
    if (!/<feed[\s>]/.test(xml)) throw new Error("unexpected Homerun response: not an Atom feed");
    return parseHomerunFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("homerun", ref.slug, raw.id),
      ats: "homerun",
      company: ref.name,
      title: raw.title.trim(),
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      department: raw.department || undefined,
      // An entry's "2015-02-04 09:26:36" has no zone: it is UTC.
      postedAt: isoDate(/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(raw.updated) ? `${raw.updated} UTC` : raw.updated),
      url: raw.link || `https://${ref.slug.toLowerCase()}.homerun.co/`,
      employmentType: employmentType(raw.type),
      description: htmlToText(raw.description),
    };
  },
};
