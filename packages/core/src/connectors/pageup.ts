import { employmentType } from "../catalog/employment";
import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, isoDate, xmlBlocks, xmlOne } from "./parse";
import type { HttpError } from "../http";
import { jobId, type Connector } from "./types";

/**
 * PageUp, the hiring system of many universities and employers in Australia, New Zealand and the UK:
 * careers sites at careers.pageuppeople.com/{client}/{site}/{lang}/listing/. Each site's RSS feed,
 * /{client}/{site}/{lang}/latest_jobs.rss, lists every open job (the same ids as the listing) with
 * location, work type and full description in one request. Kept as slug = client number,
 * site = "{site}/{lang}" ("cw/en" when the link doesn't say).
 */
export type PageUpItem = { id: string; title: string; link: string; pubDate: string; location: string; workType: string; description: string };

const CLIENT = /^\d+$/;
const SITE = /^[a-z0-9]+\/[a-z]{2}(?:-[a-z]{2})?$/i;
const BASE = "https://careers.pageuppeople.com";

export function parsePageUpFeed(xml: string): PageUpItem[] {
  return xmlBlocks(xml, "item").map((i) => {
    const link = xmlOne(i, "link");
    return {
      id: xmlOne(i, "job:refNo") || link.match(/\/job\/(\d+)/)?.[1] || link,
      title: xmlOne(i, "title"),
      link,
      pubDate: xmlOne(i, "pubDate"),
      // "Campus|Caulfield campus": the place is the last part.
      location: xmlOne(i, "job:location").split("|").pop()!.trim(),
      workType: xmlOne(i, "job:workType"),
      description: xmlOne(i, "job:description") || xmlOne(i, "description"),
    };
  });
}

export const pageup: Connector<PageUpItem> = {
  ats: "pageup",

  detect(url) {
    if (url.hostname.toLowerCase() !== "careers.pageuppeople.com") return null;
    const [client, site, lang] = url.pathname.split("/").filter(Boolean);
    if (!client || !CLIENT.test(client)) return null;
    const s = site && lang ? `${site}/${lang}`.toLowerCase() : "";
    return { ats: "pageup", slug: client, ...(SITE.test(s) ? { site: s } : {}) };
  },

  async fetch(ref, { http }) {
    if (!CLIENT.test(ref.slug)) throw new Error(`PageUp client should be a number, got "${ref.slug}"`);
    const site = ref.site && SITE.test(ref.site) ? ref.site : "cw/en";
    const url = `${BASE}/${ref.slug}/${site}/latest_jobs.rss`;
    if (!(await robotsAllows(http, url))) throw new Error("robots.txt asks us not to read careers.pageuppeople.com");
    let xml: string;
    try {
      xml = await http.getText(url);
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("PageUp", ref.slug, "(no careers site)");
      throw err;
    }
    if (!/<rss[\s>]/.test(xml)) throw new Error("unexpected PageUp response: not an RSS feed");
    return parsePageUpFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("pageup", ref.slug, raw.id),
      ats: "pageup",
      company: ref.name,
      title: raw.title.trim(),
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title} ${raw.workType}`),
      postedAt: isoDate(raw.pubDate),
      url: raw.link,
      employmentType: employmentType(raw.workType),
      description: htmlToText(raw.description),
    };
  },
};
