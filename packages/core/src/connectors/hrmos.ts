import type { EmploymentType } from "../catalog/employment";
import { employmentType } from "../catalog/employment";
import { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { NormalizedJob, Salary, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, inlineText, isoDate, jobPostingLd, ldLocation } from "./parse";
import { firstPageFingerprint, jobId, type Connector } from "./types";

/**
 * HRMOS (BizReach's hiring system, Japan), careers pages at hrmos.co/pages/{company}/jobs (Money
 * Forward, Visional, ZOZO). The list is the page itself, 100 jobs a page (?page=N), with a count
 * ("全 227 件中 100 件"); each li.pg-list-cassette links /jobs/{id} and shows the title and the office
 * address. The job's own page has a JSON-LD JobPosting (date, type, pay, address, description).
 * Kept as slug = company. hrmos.co has no robots.txt (404), so nothing is closed.
 */
export type HrmosJob = { id: string; title: string; location: string; tags: string[] };

const PAGE = 100;
/** Beyond this many pages we stop: the rest of the list isn't gone, so the read counts as partial. */
const MAX_PAGES = 20;

const SLUG = /^[A-Za-z0-9_-]+$/;
const base = (slug: string) => `https://hrmos.co/pages/${slug}/jobs`;

/** A place in Japan: it names a prefecture (東京都, 北海道, 大阪府, 京都府, …県) or Tokyo/Osaka/Kyoto. */
const JAPAN =
  /東京|大阪|京都|北海道|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県/;

/** "Japan" when a Japanese location names a prefecture; undefined when it can't be sure. */
export const japanCountry = (location: string) => (JAPAN.test(location) ? "Japan" : undefined);

/** Workplace from Japanese text ("フルリモート", "完全在宅", "ハイブリッド"), else from English words. */
export function jpWorkplace(text: string): Workplace {
  if (/フルリモート|完全リモート|完全在宅|フル在宅/.test(text)) return "remote";
  if (/ハイブリッド/.test(text)) return "hybrid";
  return inferWorkplace(text);
}

const JP_TYPES: [RegExp, EmploymentType][] = [
  [/正社員/, "full-time"],
  [/契約社員|業務委託/, "contract"],
  [/アルバイト|パート/, "part-time"],
  [/インターン/, "internship"],
  [/派遣/, "temporary"],
];

/** Employment type from Japanese labels (正社員, 契約社員, アルバイト, …); several different ones say nothing. */
export function jpEmployment(labels: string[]): EmploymentType | undefined {
  const found = new Set(labels.flatMap((l) => JP_TYPES.filter(([re]) => re.test(l)).map(([, t]) => t)));
  if (found.size === 1) return [...found][0];
  return found.size ? undefined : employmentType(labels);
}

const PERIOD: Record<string, string> = { 年収: "year", 年俸: "year", 月給: "month", 月収: "month", 日給: "day", 時給: "hour" };
const yen = (n: string, man?: string) => Number(n.replace(/,/g, "")) * (man ? 10_000 : 1);

/** "月給 270,000円～", "年収 400万円～600万円" -> a Salary in JPY. */
export function jpSalary(raw: string): Salary | undefined {
  // Entities htmlToText leaves (&ensp;) are spaces here.
  const text = raw.replace(/&[a-z]+;/g, " ");
  const m = text.match(/(年収|年俸|月給|月収|日給|時給)\s*([\d,]+)(万)?円?\s*[～〜~-]\s*(?:([\d,]+)(万)?円)?/) ?? text.match(/(年収|年俸|月給|月収|日給|時給)\s*([\d,]+)(万)?円/);
  if (!m) return undefined;
  return { min: yen(m[2]!, m[3]), ...(m[4] ? { max: yen(m[4], m[5]) } : {}), currency: "JPY", period: PERIOD[m[1]!] };
}

/** The jobs on one list page. */
export function parseHrmosPage(html: string): HrmosJob[] {
  const out = new Map<string, HrmosJob>();
  for (const block of html.split(/<li class="pg-list-cassette\b/).slice(1)) {
    const id = block.match(/href="https:\/\/hrmos\.co\/pages\/[^/"]+\/jobs\/([A-Za-z0-9_-]+)"/)?.[1];
    const title = inlineText(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]);
    if (!id || !title || out.has(id)) continue;
    const tagList = block.match(/class="sg-tags[^"]*"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
    const tags = [...tagList.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((t) => inlineText(t[1]));
    out.set(id, { id, title, location: inlineText(block.match(/class="sg-tag-location"[^>]*>([\s\S]*?)<\/li>/)?.[1]), tags });
  }
  return [...out.values()];
}

/** The list's total ("全 227 件中 100 件"), or undefined. */
const totalOf = (html: string) => {
  const n = html.match(/pg-count"[^>]*>\s*全\s*([\d,]+)\s*件/)?.[1];
  return n ? Number(n.replace(/,/g, "")) : undefined;
};

export const hrmos: Connector<HrmosJob> = {
  ats: "hrmos",

  detect(url) {
    if (url.hostname.toLowerCase() !== "hrmos.co") return null;
    const [pages, slug] = url.pathname.split("/").filter(Boolean);
    return pages === "pages" && slug && SLUG.test(slug) ? { ats: "hrmos", slug } : null;
  },

  async fetch(ref, { http, partial, firstPage }) {
    if (!SLUG.test(ref.slug)) throw new Error(`HRMOS company should be a short name, got "${ref.slug}"`);
    if (!(await robotsAllows(http, base(ref.slug)))) throw new Error(`robots.txt asks us not to read hrmos.co/pages/${ref.slug}`);
    const out = new Map<string, HrmosJob>();
    for (let p = 1; ; p++) {
      if (p > MAX_PAGES) {
        partial?.();
        break;
      }
      let html: string;
      try {
        html = await http.getText(p === 1 ? base(ref.slug) : `${base(ref.slug)}?page=${p}`);
      } catch (err) {
        if (p === 1 && err instanceof HttpError && err.status === 404) throw new BoardClosedError("HRMOS", ref.slug, "has no careers page");
        throw err;
      }
      const jobs = parseHrmosPage(html);
      const total = totalOf(html) ?? 0;
      if (
        p === 1 &&
        total > PAGE &&
        firstPage?.(
          firstPageFingerprint(
            total,
            jobs.map((j) => j.id),
          ),
          total,
        )
      )
        return jobs;
      const before = out.size;
      for (const j of jobs) if (!out.has(j.id)) out.set(j.id, j);
      if (out.size === before || jobs.length < PAGE || out.size >= total) break;
    }
    return [...out.values()];
  },

  normalize(raw, ref): NormalizedJob {
    const country = japanCountry(raw.location);
    const type = jpEmployment(raw.tags);
    return {
      id: jobId("hrmos", ref.slug, raw.id),
      ats: "hrmos",
      company: ref.name,
      title: raw.title,
      location: raw.location,
      ...(country ? { country } : {}),
      workplace: jpWorkplace(`${raw.location} ${raw.title}`),
      ...(type ? { employmentType: type } : {}),
      url: `${base(ref.slug)}/${raw.id}`,
      description: "",
    };
  },

  // Some jobs show no office in the list; the job's own page has its address.
  vagueLocation: (raw) => !raw.location,

  async describe(raw, ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${base(ref.slug)}/${raw.id}`));
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
