import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText } from "../text";
import { isoDate, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Remote First Jobs' public RSS feeds, one per skill or category
 * (remotefirstjobs.com/rss/jobs/{slug}.rss, the 100 newest jobs each). Their terms ask for credit
 * and a link back: every job links to its Remote First Jobs page and the board is named as the
 * source; the jobs are never shared or published. Their JSON API is closed by their robots.txt, so
 * only the feeds are read. Slug: a skill or category ("python", "software-development"); there is
 * no all-jobs feed, so "all" reads software development.
 */
export type RfjItem = { title: string; link: string; guid: string; pubDate: string; description: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT = "software-development";

export function parseRfjFeed(xml: string): RfjItem[] {
  return xmlBlocks(xml, "item").map((i) => ({
    title: xmlOne(i, "title"),
    link: xmlOne(i, "link"),
    guid: xmlOne(i, "guid"),
    pubDate: xmlOne(i, "pubDate"),
    description: xmlOne(i, "description"),
  }));
}

const feedSlug = (slug: string | undefined) => (slug && slug !== "all" && SLUG.test(slug) ? slug : DEFAULT);

export const remotefirstjobs: Connector<RfjItem> = {
  ats: "remotefirstjobs",
  label: "Remote First Jobs",
  // The feeds refresh every 10 minutes; a few reads a day is plenty.
  minIntervalHours: 6,

  detect(url) {
    if (!/(^|\.)remotefirstjobs\.com$/i.test(url.hostname)) return null;
    const slug = url.pathname.match(/^\/(?:rss\/)?jobs\/([a-z0-9-]+?)(?:\.rss)?\/?$/i)?.[1]?.toLowerCase();
    return { ats: "remotefirstjobs", slug: slug && SLUG.test(slug) ? slug : "all" };
  },

  async fetch(ref, { http }) {
    const url = `https://remotefirstjobs.com/rss/jobs/${feedSlug(ref.slug)}.rss`;
    if (!(await robotsAllows(http, url))) throw new Error("robots.txt asks us not to read remotefirstjobs.com/rss/");
    const xml = await http.getText(url);
    if (!/<rss[\s>]/.test(xml)) throw new Error("unexpected Remote First Jobs response: not an RSS feed");
    return parseRfjFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    // "Job title at Company"
    const full = raw.title.trim();
    const i = full.lastIndexOf(" at ");
    const title = i > 0 ? full.slice(0, i).trim() : full;
    const company = i > 0 ? full.slice(i + 4).trim() : "Remote First Jobs";
    const key = raw.guid || raw.link.replace(/^https:\/\/remotefirstjobs\.com\//, "");
    return {
      id: jobId("remotefirstjobs", feedSlug(ref.slug), key),
      ats: "remotefirstjobs",
      company,
      title,
      location: "Remote",
      workplace: "remote",
      postedAt: isoDate(raw.pubDate),
      url: raw.link || "https://remotefirstjobs.com/",
      description: htmlToText(raw.description),
    };
  },
};
