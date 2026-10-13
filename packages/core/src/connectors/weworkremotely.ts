import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText } from "../text";
import { isoDate, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * We Work Remotely's public RSS feeds: one per category (weworkremotely.com/categories/{slug}.rss)
 * and one for all jobs. Every job links back to its We Work Remotely page and the board is
 * credited by name; the jobs are never shared or published. Slug: a category ("remote-
 * programming-jobs") or "all".
 */
export type WwrItem = { title: string; region: string; category: string; description: string; pubDate: string; link: string; guid: string };

const SLUG = /^[a-z0-9-]+$/;

export function parseWwrFeed(xml: string): WwrItem[] {
  return xmlBlocks(xml, "item").map((i) => ({
    title: xmlOne(i, "title"),
    region: xmlOne(i, "region"),
    category: xmlOne(i, "category"),
    description: xmlOne(i, "description"),
    pubDate: xmlOne(i, "pubDate"),
    link: xmlOne(i, "link"),
    guid: xmlOne(i, "guid"),
  }));
}

export const weworkremotely: Connector<WwrItem> = {
  ats: "weworkremotely",
  label: "We Work Remotely",
  // The feeds say ttl 60; a few times a day is plenty.
  minIntervalHours: 6,

  detect(url) {
    if (!/(^|\.)weworkremotely\.com$/i.test(url.hostname)) return null;
    const category = url.pathname.match(/^\/categories\/([a-z0-9-]+?)(?:\.rss)?\/?$/i)?.[1]?.toLowerCase();
    return { ats: "weworkremotely", slug: category && SLUG.test(category) ? category : "all" };
  },

  async fetch(ref, { http }) {
    const path = ref.slug && ref.slug !== "all" && SLUG.test(ref.slug) ? `categories/${ref.slug}.rss` : "remote-jobs.rss";
    const xml = await http.getText(`https://weworkremotely.com/${path}`);
    if (!/<rss[\s>]/.test(xml)) throw new Error("unexpected We Work Remotely response: not an RSS feed");
    return parseWwrFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    // "Company: Job title"
    const full = decodeEntities(raw.title).trim();
    const i = full.indexOf(": ");
    const company = i > 0 ? full.slice(0, i).trim() : "We Work Remotely";
    const title = i > 0 ? full.slice(i + 2).trim() : full;
    const region = decodeEntities(raw.region)
      .replace(/^Remote\s*-?\s*/i, "")
      .trim();
    const url = raw.link || raw.guid;
    return {
      id: jobId("weworkremotely", ref.slug || "all", url.replace(/^https:\/\/weworkremotely\.com\/remote-jobs\//, "")),
      ats: "weworkremotely",
      company,
      title,
      location: region && !/^anywhere/i.test(region) ? `Remote (${region})` : "Remote",
      workplace: "remote",
      department: decodeEntities(raw.category).trim() || undefined,
      postedAt: isoDate(raw.pubDate),
      url,
      description: htmlToText(decodeEntities(raw.description)),
    };
  },
};
