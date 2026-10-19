import { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { NormalizedJob } from "../schema";
import { htmlToText } from "../text";
import { japanCountry, jpWorkplace } from "./hrmos";
import { BoardClosedError, inlineText, isoDate, jobPostingLd, ldLocation } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * HERP Hire (Japan), careers pages at herp.careers/v1/{company}, jobs at /v1/{company}/{12-character id}.
 * The list is one server-rendered page with every job: each card's a.requisition-list-card__header-anchor
 * links the job and holds its title. The list shows no place, so describe() reads it from the job's
 * JSON-LD (with the date and description). Kept as slug = company. robots.txt closes /ref/, /apply and
 * links with ?viaCareers=, so job links are always built bare.
 */
export type HerpJob = { id: string; title: string };

const SLUG = /^[A-Za-z0-9_-]+$/;
const base = (slug: string) => `https://herp.careers/v1/${slug}`;

/** The jobs on the list page. */
export function parseHerpList(html: string): HerpJob[] {
  const out = new Map<string, HerpJob>();
  for (const m of html.matchAll(/<a[^>]*class="[^"]*requisition-list-card__header-anchor[^"]*"[^>]*href="\/v1\/[^/"]+\/([A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = inlineText(m[2]);
    if (title && !out.has(m[1]!)) out.set(m[1]!, { id: m[1]!, title });
  }
  return [...out.values()];
}

export const herp: Connector<HerpJob> = {
  ats: "herp",

  detect(url) {
    if (url.hostname.toLowerCase() !== "herp.careers") return null;
    const [v, slug] = url.pathname.split("/").filter(Boolean);
    return v === "v1" && slug && SLUG.test(slug) ? { ats: "herp", slug } : null;
  },

  async fetch(ref, { http }) {
    if (!SLUG.test(ref.slug)) throw new Error(`HERP company should be a short name, got "${ref.slug}"`);
    if (!(await robotsAllows(http, base(ref.slug)))) throw new Error(`robots.txt asks us not to read herp.careers/v1/${ref.slug}`);
    try {
      return parseHerpList(await http.getText(base(ref.slug)));
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new BoardClosedError("HERP", ref.slug, "has no careers page");
      throw err;
    }
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("herp", ref.slug, raw.id),
      ats: "herp",
      company: ref.name,
      title: raw.title,
      location: "",
      workplace: jpWorkplace(raw.title),
      url: `${base(ref.slug)}/${raw.id}`,
      description: "",
    };
  },

  // The list never shows a place.
  vagueLocation: () => true,

  async describe(raw, ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${base(ref.slug)}/${raw.id}`));
    // The address is free text, often with a note after "※" about where else the job may move.
    const location = inlineText(ldLocation(ld).split("※")[0]);
    const country = japanCountry(location);
    const postedAt = isoDate(ld?.datePosted);
    const workplace = jpWorkplace(`${location} ${raw.title}`);
    return {
      description: htmlToText(ld?.description ?? ""),
      ...(location ? { location } : {}),
      ...(country ? { country } : {}),
      ...(workplace !== "unknown" ? { workplace } : {}),
      ...(postedAt ? { postedAt } : {}),
    };
  },
};
