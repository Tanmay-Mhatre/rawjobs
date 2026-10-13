import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, joinParts, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Teamtailor careers sites live on {company}.teamtailor.com or on the company's own domain
 * (careers.acme.com). A slug with a dot is that host; both serve the same /jobs.rss.
 */
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export const isTeamtailorHost = (slug: string) => slug.includes(".") && HOST.test(slug);
export const teamtailorBase = (slug: string) => (isTeamtailorHost(slug) ? `https://${slug.toLowerCase()}` : `https://${slug}.teamtailor.com`);
/** Teamtailor's feeds declare its namespace: how a feed on any domain proves it is one. */
export const isTeamtailorFeed = (xml: string) => /<rss[\s>]/.test(xml) && /xmlns:tt="https?:\/\/teamtailor\.com/.test(xml);

/** One <item> of a Teamtailor careers site's /jobs.rss, its public feed (descriptions included). */
export type TeamtailorItem = {
  guid: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  remoteStatus: string;
  department: string;
  locations: { city: string; country: string; name: string }[];
};

export function parseTeamtailor(xml: string): TeamtailorItem[] {
  return xmlBlocks(xml, "item").map((i) => ({
    guid: xmlOne(i, "guid"),
    title: xmlOne(i, "title"),
    link: xmlOne(i, "link"),
    pubDate: xmlOne(i, "pubDate"),
    description: xmlOne(i, "description"),
    remoteStatus: xmlOne(i, "remoteStatus"),
    department: xmlOne(i, "tt:department"),
    locations: xmlBlocks(i, "tt:location").map((l) => ({ city: xmlOne(l, "tt:city"), country: xmlOne(l, "tt:country"), name: xmlOne(l, "tt:name") })),
  }));
}

/** remoteStatus: "none" (on-site), "hybrid", "temporary" or "fully" (remote). */
const WORKPLACE: Record<string, Workplace> = { none: "onsite", hybrid: "hybrid", fully: "remote", temporary: "remote" };

export const teamtailor: Connector<TeamtailorItem> = {
  ats: "teamtailor",
  detect: detectAs("teamtailor"),

  async fetch(ref, { http }) {
    if (ref.slug.includes(".") && !isTeamtailorHost(ref.slug)) throw new Error(`not a careers site host: ${ref.slug}`);
    const xml = await http.getText(`${teamtailorBase(ref.slug)}/jobs.rss`);
    if (!/<rss[\s>]/.test(xml)) throw new Error("unexpected Teamtailor response: not an RSS feed");
    // On a company's own domain, only a feed that really is Teamtailor's counts.
    if (isTeamtailorHost(ref.slug) && !isTeamtailorFeed(xml)) throw new Error(`${ref.slug} is not a Teamtailor careers site`);
    return parseTeamtailor(xml);
  },

  normalize(raw, ref): NormalizedJob {
    const workplace = WORKPLACE[raw.remoteStatus];
    const places = [...new Set(raw.locations.map((l) => joinParts(l.city || l.name, l.country)).filter(Boolean))].join("; ");
    const location = joinParts(places, workplace === "remote" ? "Remote" : undefined);
    return {
      id: jobId("teamtailor", ref.slug, raw.guid || raw.link),
      ats: "teamtailor",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country: raw.locations[0]?.country || undefined,
      workplace: workplace ?? inferWorkplace(location),
      department: raw.department || undefined,
      postedAt: isoDate(raw.pubDate),
      url: raw.link,
      description: htmlToText(raw.description),
    };
  },
};
