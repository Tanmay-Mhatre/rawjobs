import type { NormalizedJob } from "../schema";
import { decodeEntities, htmlToText, inferWorkplace } from "../text";
import { jobId, type Connector } from "./types";

/**
 * Paycor Recruiting career sites: recruitingbypaycor.com/career/CareerHome.action?clientId={32 hex}.
 * The page lists every open job (title, place, grouped by department); each job page holds the
 * description in #gnewtonJobDescriptionText.
 */
export type PaycorJob = { id: string; title: string; location: string; department?: string };

const BASE = "https://recruitingbypaycor.com/career";
const CLIENT = /^[0-9a-f]{32}$/i;

const client = (slug: string) => {
  if (!CLIENT.test(slug)) throw new Error(`Paycor clientId should be 32 hex characters, got "${slug}"`);
  return slug.toLowerCase();
};
const text = (html: string | undefined) => (html ? htmlToText(decodeEntities(html)).replace(/\s+/g, " ").trim() : "");

/** Every job on the career listing, with the department heading it sits under. */
export function parsePaycorListing(html: string): PaycorJob[] {
  const out: PaycorJob[] = [];
  let department: string | undefined;
  for (const part of html.split(/(?=<div class="gnewtonCareerGroup(?:HeaderClass|RowClass)">)/)) {
    if (part.startsWith('<div class="gnewtonCareerGroupHeaderClass">')) {
      department = text(part.match(/^<div class="gnewtonCareerGroupHeaderClass">([\s\S]*?)<\/div>/)?.[1]) || undefined;
      continue;
    }
    const link = part.match(/<a[^>]*href="[^"]*JobIntroduction\.action\?[^"]*\bid=([0-9a-f]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const title = text(link[2]);
    const location = text(part.match(/<div class="gnewtonCareerGroupJobDescriptionClass">([\s\S]*?)<\/div>/)?.[1]);
    if (title) out.push({ id: link[1]!, title, location, department });
  }
  return out;
}

/** The job page's description: the #gnewtonJobDescriptionText element (a td or a div), nested ones included. */
export function paycorDescription(html: string): string {
  const open = html.match(/<(td|div)\b[^>]*id="gnewtonJobDescriptionText"[^>]*>/);
  if (!open || open.index === undefined) return "";
  const tag = open[1]!;
  let depth = 0;
  for (const m of html.slice(open.index).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "g"))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return htmlToText(html.slice(open.index, open.index + m.index! + m[0].length));
  }
  return htmlToText(html.slice(open.index));
}

export const paycor: Connector<PaycorJob> = {
  ats: "paycor",

  detect(url) {
    if (url.hostname.toLowerCase() !== "recruitingbypaycor.com") return null;
    const id = url.searchParams.get("clientId");
    return id && CLIENT.test(id) ? { ats: "paycor", slug: id.toLowerCase() } : null;
  },

  async fetch(ref, { http }) {
    const html = await http.getText(`${BASE}/CareerHome.action?clientId=${client(ref.slug)}`);
    if (!/gnewton/i.test(html)) throw new Error(`Paycor career site "${ref.slug}" not found`);
    return parsePaycorListing(html);
  },

  async describe(raw, ref, { http }) {
    return paycorDescription(await http.getText(`${BASE}/JobIntroduction.action?clientId=${client(ref.slug)}&id=${raw.id}&lang=en`));
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("paycor", ref.slug, raw.id),
      ats: "paycor",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      department: raw.department,
      url: `${BASE}/JobIntroduction.action?clientId=${client(ref.slug)}&id=${raw.id}&lang=en`,
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },
};
