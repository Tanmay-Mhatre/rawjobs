import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, countryName, isoDate, joinParts, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Taleo Business Edition (Oracle's small-business Taleo, not enterprise Taleo): careers sites at
 * {pod}.tbe.taleo.net/{pod}{NN}/ats/careers/v2/searchResults?org={ORG}&cws={N}. Its RSS feed,
 * /ats/servlet/Rss?org=&cws=, lists every open job with location and full description in one call.
 * Kept as slug = ORG, shard = "{pod}.tbe.taleo.net/{pod}{NN}", site = cws. Lists often carry a stale
 * pod or cws (the feed then redirects to an error page); TBE's dispatcher, on any pod, redirects to
 * the board's current one, so the fetch asks it once and reads the feed there.
 */
export type TaleoBeItem = {
  title: string;
  link: string;
  pubDate: string;
  reqId: string;
  location: string;
  city: string;
  state: string;
  country: string;
  description: string;
};

const ORG = /^[A-Za-z0-9_-]+$/;
const SHARD = /^([a-z]+\d*)\.tbe\.taleo\.net\/([a-z]+\d+)$/i;

/** The careers-site address for a board (the dispatcher when its pod isn't known). */
export function taleoBeUrl(c: { slug: string; shard?: string; site?: string }): string {
  const org = encodeURIComponent(c.slug);
  if (c.shard && SHARD.test(c.shard) && c.site) return `https://${c.shard}/ats/careers/v2/jobSearch?org=${org}&cws=${encodeURIComponent(c.site)}`;
  return dispatcher(c);
}

const dispatcher = (c: { slug: string; shard?: string; site?: string }) =>
  `https://${c.shard?.match(SHARD)?.[1] ?? "phh"}.tbe.taleo.net/dispatcher/servlet/DispatcherServlet?org=${encodeURIComponent(c.slug)}&act=redirectCws&cws=${encodeURIComponent(c.site || "1")}`;

export function parseTaleoBeFeed(xml: string): TaleoBeItem[] {
  return xmlBlocks(xml, "item").map((i) => ({
    title: xmlOne(i, "title"),
    link: xmlOne(i, "link"),
    pubDate: xmlOne(i, "pubDate"),
    reqId: xmlOne(i, "taleo:reqId"),
    location: xmlOne(i, "taleo:location"),
    city: xmlOne(i, "taleo:locationCity"),
    state: xmlOne(i, "taleo:locationState"),
    country: xmlOne(i, "taleo:locationCountry"),
    description: xmlOne(i, "taleo:html-description") || xmlOne(i, "description"),
  }));
}

async function readFeed(shard: string, org: string, cws: string, http: Ctx["http"]): Promise<string | undefined> {
  const url = `https://${shard}/ats/servlet/Rss?org=${encodeURIComponent(org)}&cws=${encodeURIComponent(cws)}`;
  if (!(await robotsAllows(http, url))) throw new Error(`robots.txt asks us not to read ${shard.split("/")[0]}`);
  const xml = await http.getText(url);
  return /<rss[\s>]/.test(xml) ? xml : undefined;
}

/** The board's current pod and careers site, from where TBE's dispatcher redirects. */
async function resolve(ref: { slug: string; shard?: string; site?: string }, http: Ctx["http"]): Promise<{ shard: string; cws: string }> {
  const res = await http.request(dispatcher(ref), {});
  await res.body?.cancel().catch(() => {});
  const end = new URL(res.url || dispatcher(ref));
  const path = end.pathname.split("/").filter(Boolean)[0] ?? "";
  const cws = end.searchParams.get("cws");
  if (!/\.tbe\.taleo\.net$/i.test(end.hostname) || !/^[a-z]+\d+$/i.test(path) || !cws) throw new BoardClosedError("Taleo Business Edition", ref.slug, "(TBE has no careers site for this org)");
  return { shard: `${end.hostname.toLowerCase()}/${path}`, cws };
}

export const taleobe: Connector<TaleoBeItem> = {
  ats: "taleobe",

  detect(url) {
    const host = url.hostname.toLowerCase();
    const pod = host.match(/^([a-z]+\d*)\.tbe\.taleo\.net$/)?.[1];
    const org = url.searchParams.get("org");
    if (!pod || !org || !ORG.test(org)) return null;
    const path = url.pathname.split("/").filter(Boolean)[0] ?? "";
    const cws = url.searchParams.get("cws") ?? undefined;
    return { ats: "taleobe", slug: org, ...(/^[a-z]+\d+$/i.test(path) ? { shard: `${host}/${path.toLowerCase()}` } : {}), ...(cws && /^\d+$/.test(cws) ? { site: cws } : {}) };
  },

  async fetch(ref, { http }) {
    if (!ORG.test(ref.slug)) throw new Error(`Taleo Business Edition org should be a code like ACME, got "${ref.slug}"`);
    let xml = ref.shard && SHARD.test(ref.shard) && ref.site ? await readFeed(ref.shard, ref.slug, ref.site, http).catch(() => undefined) : undefined;
    if (!xml) {
      const where = await resolve(ref, http);
      xml = await readFeed(where.shard, ref.slug, where.cws, http);
    }
    if (!xml) throw new Error(`Taleo Business Edition board "${ref.slug}" not found`);
    return parseTaleoBeFeed(xml);
  },

  normalize(raw, ref): NormalizedJob {
    const country = countryName(raw.country);
    const state = raw.state.replace(/^[A-Z]{2}-/, "");
    const location = raw.city ? joinParts(raw.city, state, country) : joinParts(raw.location, country);
    const rid = raw.reqId || raw.link.match(/[?&]rid=(\d+)/)?.[1] || raw.link;
    return {
      id: jobId("taleobe", ref.slug, rid),
      ats: "taleobe",
      company: ref.name,
      title: raw.title.trim(),
      location,
      country,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      postedAt: isoDate(raw.pubDate),
      url: raw.link,
      description: htmlToText(raw.description),
    };
  },
};
