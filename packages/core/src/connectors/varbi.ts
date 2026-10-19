import type { NormalizedJob } from "../schema";
import type { HttpError } from "../http";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, inlineText, isoDate, joinParts, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Varbi, the hiring system of Swedish universities, regions and agencies, at {tenant}.varbi.com.
 * Its RSS feed, /what:rssfeed/, lists every open job with title, link (…/what:job/jobID:{id}/),
 * full description and date in one request, but no place: the job's page has it in its quick-info
 * table (Ort, Land), read by describe() for the jobs whose title passes. Kept as slug = tenant.
 * robots.txt closes the site only to a list of named crawlers.
 */
export type VarbiItem = { id: string; title: string; link: string; pubDate: string; description: string };

const TENANT = /^[a-z0-9][a-z0-9-]*$/i;

export function parseVarbiFeed(xml: string): VarbiItem[] {
  return xmlBlocks(xml, "item").map((i) => {
    const link = xmlOne(i, "link") || xmlOne(i, "guid");
    return {
      id: link.match(/jobID:(\d+)/i)?.[1] ?? link,
      title: xmlOne(i, "title"),
      link,
      pubDate: xmlOne(i, "pubDate"),
      description: xmlOne(i, "description"),
    };
  });
}

/** One row of the job page's quick-info table ("town", "country"). */
const quickInfo = (html: string, key: string) => inlineText(html.match(new RegExp(`class="quick-info-${key}"[^>]*>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)</td>`, "i"))?.[1]);

export const varbi: Connector<VarbiItem> = {
  ats: "varbi",

  detect(url) {
    const tenant = url.hostname.toLowerCase().match(/^([a-z0-9-]+)\.varbi\.com$/)?.[1];
    return tenant && tenant !== "www" ? { ats: "varbi", slug: tenant } : null;
  },

  async fetch(ref, { http }) {
    if (!TENANT.test(ref.slug)) throw new Error(`Varbi tenant should be a short name, got "${ref.slug}"`);
    const url = `https://${ref.slug.toLowerCase()}.varbi.com/what:rssfeed/`;
    if (!(await robotsAllows(http, url))) throw new Error(`robots.txt asks us not to read ${ref.slug}.varbi.com`);
    let xml: string;
    try {
      xml = await http.getText(url);
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("Varbi", ref.slug, "(no jobsite)");
      throw err;
    }
    if (!/<rss[\s>]/.test(xml)) throw new Error("unexpected Varbi response: not an RSS feed");
    return parseVarbiFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("varbi", ref.slug, raw.id),
      ats: "varbi",
      company: ref.name,
      title: raw.title,
      location: "",
      workplace: inferWorkplace(raw.title),
      postedAt: isoDate(raw.pubDate),
      url: raw.link,
      description: htmlToText(raw.description),
    };
  },

  // The feed has no place at all; the job's page has it.
  vagueLocation: () => true,

  async describe(raw, _ref, { http }) {
    const html = await http.getText(raw.link);
    const location = joinParts(quickInfo(html, "town"), quickInfo(html, "country"));
    return { description: htmlToText(raw.description), ...(location ? { location } : {}) };
  },
};
