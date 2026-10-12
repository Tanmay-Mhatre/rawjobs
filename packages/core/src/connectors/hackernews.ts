import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { jobId, type Connector } from "./types";

/**
 * Hacker News "Ask HN: Who is hiring?" (monthly, posted by the whoishiring account), read through
 * Algolia's free HN API (https://hn.algolia.com/api). Each top-level comment is one company's post,
 * conventionally "Company | Role | Location | ..." on the first line; parsing that is best effort.
 */
export type HnComment = { id: number; text?: string | null; created_at?: string; author?: string; children?: unknown[] };

const API = "https://hn.algolia.com/api/v1";
/** Words that make a "|" segment the role. */
const ROLE =
  /\b(engineer|developer|manager|designer|scientist|analyst|lead|head|director|architect|researcher|product|marketing|sales|recruiter|founding|intern|devops|sre|cto|vp|officer|specialist|consultant|writer|ops|operations|support|success)\b/i;
/** Words that make a segment a place or a way of working (any case), or a "City, Country" or "NY"-style code. */
const PLACE_WORD = /\b(remote|onsite|on-site|in office|hybrid|anywhere|worldwide|usa|uk|eu|europe|emea|apac)\b/i;
const PLACE_SHAPE = /\b([A-Z]{2}|[A-Z][a-z]+,\s*[A-Z][A-Za-z]+)\b/;

/** The post's first line split on "|" (or " — "): company, role and places. */
export function parseHiringPost(text: string): { company: string; title: string; location: string } {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  const parts = first
    .split(/\s*\|\s*|\s+[—–]\s+/)
    .map((p) =>
      p
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  // "Acme (YC W24)" or "Acme (Remote US)": the brackets aren't the name, but may say where.
  const bracket = (parts[0] ?? "").match(/\s*\((.*?)\)\s*$/);
  const company = (parts[0] ?? "").replace(/\s*\(.*?\)\s*$/, "").slice(0, 80);
  const rest = parts.slice(1);
  const isPlace = (p: string) => PLACE_WORD.test(p) || PLACE_SHAPE.test(p);
  const title = rest.find((p) => ROLE.test(p)) ?? rest.find((p) => !isPlace(p)) ?? "";
  const places = rest.filter((p) => p !== title && isPlace(p));
  if (bracket?.[1] && PLACE_WORD.test(bracket[1])) places.unshift(bracket[1]);
  return { company, title: title.slice(0, 160), location: places.join("; ") };
}

export const hackernews: Connector<HnComment> = {
  ats: "hackernews",
  label: "Hacker News: Who is hiring",
  // One thread a month: twice a day is plenty, and kind to a free API.
  minIntervalHours: 12,

  detect(url) {
    return /^news\.ycombinator\.com$/i.test(url.hostname) ? { ats: "hackernews", slug: "whoishiring" } : null;
  },

  async fetch(_ref, { http }) {
    const search = await http.getJson<{ hits?: { objectID: string; title?: string }[] }>(`${API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`);
    const thread = search.hits?.find((h) => /who is hiring/i.test(h.title ?? ""));
    if (!thread) throw new Error('no current "Who is hiring?" thread found');
    const item = await http.getJson<{ children?: HnComment[] }>(`${API}/items/${thread.objectID}`);
    return (item.children ?? []).filter((c) => c.text);
  },

  normalize(raw): NormalizedJob {
    const text = htmlToText(raw.text);
    // The header is the post's first paragraph (HN separates them with <p>).
    const header = (raw.text ?? "").split(/<\/?p>/i).find((p) => p.trim()) ?? "";
    const { company, title, location } = parseHiringPost(htmlToText(header));
    return {
      id: jobId("hackernews", "whoishiring", raw.id),
      ats: "hackernews",
      company: company || "Hacker News post",
      title: title || "See post",
      location,
      workplace: inferWorkplace(location || text.split("\n")[0] || ""),
      postedAt: raw.created_at,
      url: `https://news.ycombinator.com/item?id=${raw.id}`,
      description: text,
    };
  },
};
