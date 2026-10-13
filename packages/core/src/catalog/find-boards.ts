import { companyKey, detectCompany, type DetectResult } from "../connectors";
import { isTeamtailorHost } from "../connectors/teamtailor";

export type FoundBoard = DetectResult & { key: string /** The URL on the page that revealed it. */; evidence: string };

const CAREERS_WORDS = /career|jobs?\b|join[- ]?us|join[- ]?the[- ]?team|vacanc|work[- ]?with[- ]?us|openings|hiring|we.?re[- ]?hiring/i;

/** Every absolute http(s) URL in a page: attributes (href, src, data-*, …) and URLs inside scripts. */
export function urlsInHtml(html: string, base: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const v = raw.trim().replace(/&amp;/g, "&").replace(/\\\//g, "/");
    if (!v || v.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(v)) return;
    try {
      const u = new URL(v, base);
      if (u.protocol === "http:" || u.protocol === "https:") out.add(u.href);
    } catch {
      // not a URL
    }
  };
  for (const m of html.matchAll(/\s(?:href|src|data-[\w-]+|action|content)\s*=\s*["']([^"']+)["']/gi)) add(m[1]!);
  // Embedded widgets often build the board URL in a script, sometimes JSON-escaped ("https:\/\/…").
  for (const m of html.replace(/\\\//g, "/").matchAll(/https?:\/\/[^\s"'<>()\\]+/g)) add(m[0]);
  return [...out];
}

/** Hiring-system boards linked from a page, supported ones first, one per board. */
export function findBoards(html: string, base: string): FoundBoard[] {
  const seen = new Map<string, FoundBoard>();
  for (const url of [base, ...urlsInHtml(html, base)]) {
    const d = detectCompany(url);
    if (!d) continue;
    const key = companyKey(d);
    if (!seen.has(key)) seen.set(key, { ...d, key, evidence: url });
  }
  // Comeet's script embed names the company only by uid: COMEET.init({ "company-uid": "41.009", … }).
  if (/comeet/i.test(html)) {
    const uid = html.match(/["']?company[-_]uid["']?\s*[:=]\s*["']([0-9A-Za-z]+\.[0-9A-Za-z]+)["']/)?.[1];
    if (uid) {
      const key = companyKey({ ats: "comeet", slug: uid });
      if (!seen.has(key)) seen.set(key, { ats: "comeet", slug: uid, name: "", supported: false, key, evidence: base });
    }
  }
  // A Teamtailor careers site on the company's own domain loads Teamtailor's assets; the host is the
  // board (the live check then reads its /jobs.rss and accepts only Teamtailor's feed).
  if (/teamtailor-cdn\.com/i.test(html)) {
    try {
      const host = new URL(base).hostname.toLowerCase();
      if (isTeamtailorHost(host) && !host.endsWith(".teamtailor.com")) {
        const key = companyKey({ ats: "teamtailor", slug: host });
        if (!seen.has(key)) seen.set(key, { ats: "teamtailor", slug: host, name: "", supported: true, key, evidence: base });
      }
    } catch {
      // base isn't a URL
    }
  }
  // Supported first; then the board seen most often on the page.
  const counts = (key: string) => html.split(key.split(":")[1]!.split("|")[0]!).length;
  return [...seen.values()].sort((a, b) => Number(b.supported) - Number(a.supported) || counts(b.key) - counts(a.key));
}

/** Script, stylesheet and markup traces of hiring systems: which one a page uses even when no board URL is visible. */
const HINTS: [string, RegExp][] = [
  ["comeet", /comeet/i],
  ["workday", /myworkdayjobs\.com|myworkdaysite\.com|myworkday\.com/i],
  ["successfactors", /successfactors|sapsf\.|jobs2web/i],
  ["teamtailor", /teamtailor/i],
  ["personio", /personio/i],
  ["workable", /workable\.com/i],
  ["recruitee", /recruitee/i],
  ["bamboohr", /bamboohr/i],
  ["hibob", /hibob/i],
  ["icims", /icims\.com/i],
  ["taleo", /taleo\.net/i],
  ["oracle", /oraclecloud\.com\/hcmUI/i],
  ["smartrecruiters", /smartrecruiters/i],
  ["greenhouse", /greenhouse\.io/i],
  ["lever", /\bjobs\.(eu\.)?lever\.co\b/i],
  ["ashby", /ashbyhq/i],
  ["jobvite", /jobvite/i],
  ["pinpoint", /pinpointhq/i],
  ["breezy", /breezy\.hr/i],
  ["zoho", /zohorecruit/i],
  ["manatal", /careers-page\.com|manatal/i],
  ["hiringthing", /HiringThing\.Components|hiringthing\.com/i],
  ["paycor", /recruitingbypaycor\.com/i],
  ["applicantpro", /applicantpro\.com|isolvedhire\.com|applicant-pro-components/i],
  ["adp", /workforcenow\.adp\.com/i],
  ["dayforce", /dayforcehcm\.com/i],
  ["careerplug", /careerplug\.com/i],
  ["phenom", /phenompeople|cdn\.phenompeople\.com/i],
  ["eightfold", /eightfold\.ai/i],
  ["ukg", /ultipro\.com|rec\.pro\.ukg\.net/i],
  ["hireology", /hireology\.com/i],
  ["paycom", /paycomonline\.net\/v4\/ats/i],
  ["paylocity", /recruiting\.paylocity\.com/i],
  ["join", /join\.com\/companies\//i],
];

export function atsHints(html: string): string[] {
  return HINTS.filter(([, re]) => re.test(html)).map(([ats]) => ats);
}

/** Links on a page that look like a careers page, on the same site or one of its subdomains. */
export function careersLinks(html: string, base: string): string[] {
  const site = new URL(base).hostname.replace(/^www\./, "");
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2]!.replace(/<[^>]+>/g, " ");
    if (!CAREERS_WORDS.test(m[1]!) && !CAREERS_WORDS.test(text)) continue;
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
      const host = u.hostname.replace(/^www\./, "");
      if ((u.protocol === "https:" || u.protocol === "http:") && (host === site || host.endsWith(`.${site}`))) {
        u.hash = "";
        if (!out.includes(u.href)) out.push(u.href);
      }
    } catch {
      // not a URL
    }
  }
  return out;
}
