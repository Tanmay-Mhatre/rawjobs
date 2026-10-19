import type { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, isoDate } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Emply, a Danish hiring system: careers sites at {tenant}.career.emply.com/{lang}/…, kept as
 * slug = tenant. The site's front page names its job section (sectionId: '…') and language
 * (var languageKey = '…'); its own script then POSTs /api/integration/vacancy/get-page, which
 * returns the jobs with full descriptions, 200 a page by offset. An unknown tenant redirects to
 * emply.com. robots.txt allows everything.
 */
export type EmplyVacancy = {
  id: string;
  title: string;
  titleAsUrl: string;
  shortId: string;
  created?: string;
  published?: string;
  department?: string | null;
  location?: string | null;
  translations?: { languageKey?: string; title?: string; content?: string }[];
  /** Set by fetch(): the job's page and the site's language. */
  url: string;
  lang: string;
};

const TENANT = /^[a-z0-9][a-z0-9-]*$/i;
const PAGE = 200;
/** Beyond this we stop paging. */
const MAX_POSTINGS = 2000;

export const emply: Connector<EmplyVacancy> = {
  ats: "emply",

  detect(url) {
    const m = url.hostname.toLowerCase().match(/^([a-z0-9-]+)\.career\.emply\.com$/);
    return m ? { ats: "emply", slug: m[1]! } : null;
  },

  async fetch(ref, { http, partial }) {
    if (!TENANT.test(ref.slug)) throw new Error(`Emply careers site should be a short name, got "${ref.slug}"`);
    const host = `${ref.slug.toLowerCase()}.career.emply.com`;
    const api = `https://${host}/api/integration/vacancy/get-page`;
    if (!(await robotsAllows(http, `https://${host}/`)) || !(await robotsAllows(http, api))) throw new Error(`robots.txt asks us not to read ${host}`);
    let page: string;
    try {
      const { res, body } = await http.requestBody(`https://${host}/`, {});
      if (res.url && new URL(res.url).hostname.toLowerCase() !== host) throw new BoardClosedError("Emply", ref.slug, "(no careers site)");
      page = body;
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("Emply", ref.slug, "(no careers site)");
      throw err;
    }
    const sectionId = page.match(/sectionId:\s*'([^']+)'/)?.[1];
    const lang = page.match(/var languageKey\s*=\s*'([^']+)'/)?.[1] ?? "da-DK";
    if (!sectionId) throw new Error(`${host} has no job list (no sectionId on its front page)`);
    // The page's own ad links: '/da/ad/' + titleAsUrl + '/' + shortId.
    const ad = page.match(/'(\/[a-z]{2}(?:-[a-z]{2})?\/ad\/)'\s*\+\s*vacancy\.titleAsUrl/i)?.[1] ?? `/${lang.split("-")[0]!.toLowerCase()}/ad/`;
    const out: EmplyVacancy[] = [];
    let total = 0;
    for (let offset = 0; offset < MAX_POSTINGS; offset += PAGE) {
      const res = await http.postJson<{ vacancies?: Omit<EmplyVacancy, "url" | "lang">[]; count?: number }>(api, {
        count: PAGE,
        filters: [],
        langCode: lang,
        offset,
        searchText: "",
        sectionId,
        sortByProjectDataId: "",
        sortAscending: false,
        light: false,
        isJobAgent: false,
        siteId: null,
      });
      if (!Array.isArray(res.vacancies)) throw new Error("unexpected Emply response: no vacancies array");
      total = res.count ?? 0;
      out.push(...res.vacancies.map((v) => ({ ...v, url: `https://${host}${ad}${v.titleAsUrl}/${v.shortId}`, lang })));
      if (res.vacancies.length < PAGE || out.length >= total) break;
    }
    if (total - out.length >= PAGE) partial?.();
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const t = raw.translations?.find((x) => x.languageKey === raw.lang) ?? raw.translations?.[0];
    const location = raw.location?.trim() ?? "";
    return {
      id: jobId("emply", ref.slug, raw.id),
      ats: "emply",
      company: ref.name,
      title: (t?.title || raw.title).trim(),
      location,
      workplace: inferWorkplace(`${location} ${raw.title}`),
      department: raw.department || undefined,
      postedAt: isoDate(raw.published || raw.created),
      url: raw.url,
      description: htmlToText(t?.content ?? ""),
    };
  },
};
