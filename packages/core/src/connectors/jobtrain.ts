import { employmentType } from "../catalog/employment";
import type { NormalizedJob } from "../schema";
import { robotsAllows } from "../robots";
import { htmlToText, inferWorkplace } from "../text";
import { inlineText, isoDate } from "./parse";
import { jobId, type Connector, type Ctx } from "./types";

/**
 * Jobtrain, the UK hiring system behind NHS Scotland, councils and charities, on each employer's own
 * host (apply.jobs.scot.nhs.uk), keyed by that host. The search page loads its job cards 12 at a time
 * from /Home/_JobCard?Skip={n}, an HTML fragment with title, reference, salary, closing date,
 * location, employment type, live date and employer per card, and the total in
 * <input id="totalMatchRecords">. A job's page, /Job/JobDetail?JobId={id}, has the advert. The
 * sample hosts have no robots.txt (404: all allowed).
 */
export type JobtrainJob = {
  id: string;
  title: string;
  location: string;
  url: string;
  employmentType: string;
  liveDate: string;
  employer: string;
};

/** 12 cards a page: past this many pages we stop, and the read counts as partial. */
const MAX_PAGES = 100;

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const cardsUrl = (host: string, skip: number) => `https://${host}/Home/_JobCard?Skip=${skip}`;

/** "19/10/2026" (day first) -> ISO date. */
const ukDate = (s: string) => {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? isoDate(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`) : undefined;
};

/** The cards in one _JobCard fragment, and the total it states. */
export function parseJobtrainCards(html: string, host: string): { total: number; jobs: JobtrainJob[] } {
  const jobs: JobtrainJob[] = [];
  const starts = [...html.matchAll(/<a\b[^>]*class="mb-15"[^>]*href="\/Job\/JobDetail\?JobId=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  starts.forEach((m, i) => {
    const card = html.slice(m.index! + m[0].length, starts[i + 1]?.index ?? html.length);
    const field = (name: string) => inlineText(card.match(new RegExp(`class="jobdetailsitem ${name}"[^>]*>\\s*<strong>[\\s\\S]*?</strong>([\\s\\S]*?)</p>`, "i"))?.[1]);
    const title = inlineText(m[2]);
    if (!title || jobs.some((j) => j.id === m[1])) return;
    jobs.push({
      id: m[1]!,
      title,
      location: field("location"),
      url: `https://${host}/Job/JobDetail?JobId=${m[1]}`,
      employmentType: field("employmenttype"),
      liveDate: field("livedate"),
      employer: field("school"),
    });
  });
  const total = Number(html.match(/id="totalMatchRecords"\s+value="(\d+)"/i)?.[1] ?? jobs.length);
  return { total, jobs };
}

/** A Jobtrain site answers /Home/_JobCard with its card count: how a site on any domain proves it is one. */
export async function isJobtrainSite(host: string, http: Ctx["http"]): Promise<boolean> {
  if (!HOST.test(host)) return false;
  const url = cardsUrl(host.toLowerCase(), 0);
  if (!(await robotsAllows(http, url))) return false;
  const html = await http.getText(url).catch(() => "");
  return /id="totalMatchRecords"/i.test(html);
}

export const jobtrain: Connector<JobtrainJob> = {
  ats: "jobtrain",
  // Jobtrain sites live on the employers' own domains: found by Add by link's probe and the lists.
  detect: () => null,

  async fetch(ref, { http, partial }) {
    if (!HOST.test(ref.slug)) throw new Error(`Jobtrain site should be a host name, got "${ref.slug}"`);
    const host = ref.slug.toLowerCase();
    if (!(await robotsAllows(http, cardsUrl(host, 0)))) throw new Error(`robots.txt asks us not to read ${host}`);
    const out = new Map<string, JobtrainJob>();
    for (let p = 0, skip = 0; ; p++) {
      if (p === MAX_PAGES) {
        partial?.();
        break;
      }
      const html = await http.getText(cardsUrl(host, skip));
      if (p === 0 && !/id="totalMatchRecords"/i.test(html)) throw new Error(`${host} is not a Jobtrain site (no job cards)`);
      const { total, jobs } = parseJobtrainCards(html, host);
      const before = out.size;
      for (const j of jobs) if (!out.has(j.id)) out.set(j.id, j);
      if (out.size === before || out.size >= total) break;
      skip += jobs.length;
    }
    return [...out.values()];
  },

  normalize(raw, ref): NormalizedJob {
    return {
      id: jobId("jobtrain", ref.slug, raw.id),
      ats: "jobtrain",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      workplace: inferWorkplace(`${raw.location} ${raw.title}`),
      postedAt: ukDate(raw.liveDate),
      url: raw.url,
      employmentType: employmentType(raw.employmentType),
      description: "",
    };
  },

  async describe(raw, _ref, { http }) {
    const html = await http.getText(raw.url);
    const start = html.indexOf('data-testid="div-job-discription"');
    // Up to the tag that opens the "other details" block (documents, about the employer).
    const stop = start < 0 ? -1 : html.indexOf('data-testid="div-job-other-details"', start);
    const end = stop < 0 ? -1 : html.lastIndexOf("<", stop);
    return start < 0 ? "" : htmlToText(`<div ${html.slice(start, end < 0 ? start + 60000 : end).replace(/\r/g, "")}`);
  },
};
