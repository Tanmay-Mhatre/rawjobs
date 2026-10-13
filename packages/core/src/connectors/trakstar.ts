import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { isoDate, joinParts, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Trakstar Hire (formerly Recruiterbox) careers sites: {account}.hire.trakstar.com. Each site
 * publishes a job feed, /jobfeeds/{account}: RSS with every open job, its description and its
 * place (job:locationCity / State / Country).
 */
export type TrakstarItem = { title: string; link: string; description: string; pubDate: string; city: string; state: string; country: string; team: string };

const ACCOUNT = /^[a-z0-9][a-z0-9-]*$/i;

export function parseTrakstarFeed(xml: string): TrakstarItem[] {
  return xmlBlocks(xml, "item").map((i) => ({
    title: xmlOne(i, "title"),
    link: xmlOne(i, "link"),
    description: xmlOne(i, "description"),
    pubDate: xmlOne(i, "pubDate"),
    city: xmlOne(i, "job:locationCity"),
    state: xmlOne(i, "job:locationState"),
    country: xmlOne(i, "job:locationCountry"),
    team: xmlOne(i, "job:team"),
  }));
}

export const trakstar: Connector<TrakstarItem> = {
  ats: "trakstar",

  detect(url) {
    const sub = url.hostname.toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.hire\.trakstar\.com$/)?.[1];
    return sub && sub !== "www" ? { ats: "trakstar", slug: sub } : null;
  },

  async fetch(ref, { http }) {
    if (!ACCOUNT.test(ref.slug)) throw new Error(`Trakstar account should be a subdomain name, got "${ref.slug}"`);
    const slug = ref.slug.toLowerCase();
    const xml = await http.getText(`https://${slug}.hire.trakstar.com/jobfeeds/${slug}`);
    if (!/<rss[\s>]/.test(xml)) throw new Error(`Trakstar careers site "${ref.slug}" not found (no job feed)`);
    return parseTrakstarFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    // "None" is how the feed says a field is empty.
    const v = (s: string) => (s && s !== "None" ? decodeEntities(s).trim() : undefined);
    const location = joinParts(v(raw.city), v(raw.state), v(raw.country));
    const id = raw.link.match(/\/jobs\/([^/?#]+)/)?.[1] ?? raw.link;
    // It opens with a "Location: …" header and ends with an "Apply to this job" link: keep the text between.
    const description = htmlToText(decodeEntities(raw.description).replace(/<h2 id="job_meta">[\s\S]*?<\/h2>/, ""))
      .replace(/\s*Apply to this job\s*$/i, "")
      .trim();
    return {
      id: jobId("trakstar", ref.slug, id),
      ats: "trakstar",
      company: ref.name,
      title: decodeEntities(raw.title).trim(),
      location,
      country: v(raw.country),
      workplace: inferWorkplace(`${location} ${raw.title}`),
      department: v(raw.team),
      postedAt: isoDate(raw.pubDate),
      url: raw.link.replace(/^http:/, "https:"),
      description,
    };
  },
};
