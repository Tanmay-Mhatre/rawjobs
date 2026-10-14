import type { CompanyRef, NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, inlineText, isoDate, jobPostingLd, ldLocation } from "./parse";
import { jobId, SEARCH_MAX_POSTINGS, type Connector, type Ctx } from "./types";

/** A job card from an iCIMS portal's search page (iCIMS has no public feed; this is the page itself). */
export type IcimsJob = { id: string; title: string; url: string; location: string; postedAt?: string };

/** Pages of 20 (some portals 50); beyond this we stop. */
const MAX_PAGES = 50;

const host = (ref: { slug: string }) => `https://${ref.slug}.icims.com`;

/** Cards from one search page. Templates differ, so each card is the markup between two job links. */
export function parseIcimsPage(html: string, origin: string): IcimsJob[] {
  const re = /<a[^>]+href="((?:https?:\/\/[^"/]+)?\/jobs\/(\d+)\/[^"]*\/job[^"]*)"[^>]*>/g;
  const links = [...html.matchAll(re)];
  const out = new Map<string, IcimsJob>();
  links.forEach((m, i) => {
    const id = m[2]!;
    if (out.has(id)) return;
    // The card: from the end of the previous link to the start of the next one.
    const from = i > 0 ? links[i - 1]!.index! + links[i - 1]![0].length : Math.max(0, m.index! - 1500);
    const to = links[i + 1]?.index ?? m.index! + 4000;
    const card = html.slice(from, to);
    const after = html.slice(m.index!, to);
    const titleAttr = m[0].match(/title="([^"]*)"/)?.[1];
    const title = inlineText(after.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/)?.[1] ?? after.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1]) || inlineText(titleAttr?.replace(/^\d+\s*-\s*/, ""));
    const location = inlineText(card.match(/Job Locations?\s*<\/(?:span|dt|div)>\s*(?:<[^>]+>\s*)*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const posted = card.match(/Posted Date[\s\S]*?title="([^"]+)"/i)?.[1];
    const href = m[1]!.startsWith("http") ? m[1]! : `${origin}${m[1]}`;
    if (title) out.set(id, { id, title, url: href.replace(/([?&])in_iframe=1&?/, "$1").replace(/[?&]$/, ""), location: location.replace(/\s*\|\s*/g, "; "), postedAt: isoDate(posted) });
  });
  return [...out.values()];
}

/** The portal's search pages, all jobs or those matching `searchKeyword`, up to `maxPages`. */
async function list(ref: CompanyRef, http: Ctx["http"], searchKeyword: string, maxPages: number) {
  const out = new Map<string, IcimsJob>();
  const keyword = searchKeyword ? `&searchKeyword=${encodeURIComponent(searchKeyword)}` : "";
  let pages = 1;
  for (let pr = 0; pr < maxPages; pr++) {
    const html = await http.getText(`${host(ref)}/jobs/search?ss=1${keyword}&in_iframe=1&pr=${pr}`);
    if (pr === 0 && !/iCIMS/.test(html)) throw new Error("unexpected iCIMS response: not a job portal");
    const page = parseIcimsPage(html, host(ref));
    const before = out.size;
    for (const j of page) out.set(j.id, j);
    pages = Number(html.match(/Page\s+\d+\s+of\s+(\d+)/i)?.[1] ?? 1);
    if (out.size === before || pr + 1 >= pages) break;
  }
  return { out: [...out.values()], pages };
}

export const icims: Connector<IcimsJob> = {
  ats: "icims",
  detect: detectAs("icims"),

  async fetch(ref, { http, partial }) {
    const { out, pages } = await list(ref, http, "", MAX_PAGES);
    // The portal has more pages than we read.
    if (pages > MAX_PAGES) partial?.();
    return out;
  },

  async search(ref, term, { http }) {
    // Pages of 20 on most portals.
    return (await list(ref, http, term, Math.ceil(SEARCH_MAX_POSTINGS / 20))).out;
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("icims", ref.slug, raw.id),
      ats: "icims",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(raw.location),
      postedAt: raw.postedAt,
      url: raw.url,
      description: "",
    };
  },

  async describe(raw, _ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${raw.url}${raw.url.includes("?") ? "&" : "?"}in_iframe=1`));
    return { description: htmlToText(ld?.description), location: raw.location ? undefined : ldLocation(ld) || undefined, postedAt: raw.postedAt ?? isoDate(ld?.datePosted) };
  },
};
