import { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { NormalizedJob } from "../schema";
import { htmlToText } from "../text";
import { japanCountry, jpSalary, jpWorkplace } from "./hrmos";
import { BoardClosedError, inlineText, isoDate, jobPostingLd, ldLocation } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * engage (en Japan's free hiring pages), careers pages at en-gage.net/{company}/, jobs at
 * /{company}/work_{id}/. The company page lists every job at once: each card links work_{id} and shows
 * the headline, pay and place. The job's own page has a JSON-LD JobPosting (date, type, pay,
 * description). Kept as slug = company. robots.txt has no `*` group (it names search engines and
 * blocks some AI crawlers by name), so nothing is closed to us.
 */
export type EngageJob = { id: string; title: string; location: string; pay: string };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
/** en-gage.net's own pages, not companies. */
const RESERVED = new Set(
  "user search search2 about api apply company corp help info kuchikomi lp login signup news column recruit contact privacy terms sitemap imagefile_new image js css img".split(" "),
);
const base = (slug: string) => `https://en-gage.net/${slug}/`;

/** The jobs on the company page. */
export function parseEngagePage(html: string): EngageJob[] {
  const out = new Map<string, EngageJob>();
  for (const block of html.split(/<dd class="dataArea">/).slice(1)) {
    const id = block.match(/href="\/[^/"]+\/work_(\d+)\/?[^"]*"/)?.[1];
    const title = inlineText(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]);
    if (!id || !title || out.has(id)) continue;
    const field = (name: string) => inlineText(block.match(new RegExp(`label--${name}"[\\s\\S]*?<span class="index">([\\s\\S]*?)</span>`))?.[1]);
    out.set(id, { id, title, location: field("area"), pay: field("income") });
  }
  return [...out.values()];
}

export const engage: Connector<EngageJob> = {
  ats: "engage",

  detect(url) {
    if (!/^(?:www\.)?en-gage\.net$/i.test(url.hostname)) return null;
    const slug = url.pathname.split("/").filter(Boolean)[0];
    return slug && SLUG.test(slug) && !RESERVED.has(slug.toLowerCase()) ? { ats: "engage", slug } : null;
  },

  async fetch(ref, { http }) {
    if (!SLUG.test(ref.slug) || RESERVED.has(ref.slug.toLowerCase())) throw new Error(`engage company should be a short name, got "${ref.slug}"`);
    if (!(await robotsAllows(http, base(ref.slug)))) throw new Error(`robots.txt asks us not to read en-gage.net/${ref.slug}`);
    try {
      return parseEngagePage(await http.getText(base(ref.slug)));
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new BoardClosedError("engage", ref.slug, "has no careers page");
      throw err;
    }
  },

  normalize(raw, ref): NormalizedJob {
    const country = japanCountry(raw.location);
    const salary = jpSalary(raw.pay);
    return {
      id: jobId("engage", ref.slug, raw.id),
      ats: "engage",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      ...(country ? { country } : {}),
      workplace: jpWorkplace(`${raw.location} ${raw.title}`),
      ...(salary ? { salary } : {}),
      url: `${base(ref.slug)}work_${raw.id}/`,
      description: "",
    };
  },

  vagueLocation: (raw) => !raw.location,

  async describe(raw, ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${base(ref.slug)}work_${raw.id}/`));
    const location = raw.location ? undefined : ldLocation(ld) || undefined;
    const country = location && japanCountry(location);
    const postedAt = isoDate(ld?.datePosted);
    return {
      description: htmlToText(ld?.description ?? ""),
      ...(location ? { location } : {}),
      ...(country ? { country } : {}),
      ...(postedAt ? { postedAt } : {}),
    };
  },
};
