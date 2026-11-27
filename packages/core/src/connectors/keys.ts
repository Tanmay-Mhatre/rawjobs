/**
 * Pure helpers for company keys and careers addresses, with no connector code behind them, so the
 * web app can use them without loading every connector (`@rawjobs/core/company-key`).
 */
import type { AtsType } from "../schema";
import type { DetectedCompany } from "./types";

/**
 * The hiring systems that have a connector. A test keeps this equal to the keys of `connectors`
 * in ./index.ts; it lives here so callers can check support without importing the connectors.
 */
export const SUPPORTED_ATS: ReadonlySet<AtsType> = new Set<AtsType>([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "workable",
  "recruitee",
  "personio",
  "bamboohr",
  "breezy",
  "successfactors",
  "teamtailor",
  "comeet",
  "oracle",
  "icims",
  "taleo",
  "jobvite",
  "pinpoint",
  "rippling",
  "jazzhr",
  "zoho",
  "hibob",
  "freshteam",
  "join",
  "paylocity",
  "paycom",
  "hireology",
  "ukg",
  "eightfold",
  "phenom",
  "careerplug",
  "dayforce",
  "adp",
  "applicantpro",
  "paycor",
  "hiringthing",
  "manatal",
  "trakstar",
  "factorial",
  "gem",
  "hrmdirect",
  "softgarden",
  "cornerstone",
  "keka",
  "taleobe",
  "jobscore",
  "avature",
  "pageup",
  "radancy",
  "oleeo",
  "jobtrain",
  "varbi",
  "reachmee",
  "jobylon",
  "homerun",
  "emply",
  "bullhorn",
  "hrmos",
  "herp",
  "engage",
  "hackernews",
  "remotive",
  "arbeitnow",
  "remoteok",
  "himalayas",
  "jobicy",
  "weworkremotely",
  "remotefirstjobs",
]);

/** Zoho Recruit's data centres: .com (US), .eu, .in, .com.au, .jp, .ca, .sa, .uk, .com.cn. */
export const ZOHO_HOST = /\.zohorecruit\.(com|eu|in|com\.au|jp|ca|sa|uk|com\.cn)$/;

/** The board's host: its data centre's domain (`shard`, e.g. "in", "eu"), .com when unset. */
export const zohoHost = (ref: { slug: string; shard?: string }) => `https://${ref.slug}.zohorecruit.${ref.shard && ZOHO_HOST.test(`.zohorecruit.${ref.shard}`) ? ref.shard : "com"}`;

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Teamtailor careers sites live on {company}.teamtailor.com or on the company's own domain
 * (careers.acme.com). A slug with a dot is that host; both serve the same /jobs.rss.
 */
export const isTeamtailorHost = (slug: string) => slug.includes(".") && HOST.test(slug);
export const teamtailorBase = (slug: string) => (isTeamtailorHost(slug) ? `https://${slug.toLowerCase()}` : `https://${slug}.teamtailor.com`);

/** SuccessFactors career sites ("RMK": jobs.acme.com, acme.jobs2web.com, acme.jobs.hr.cloud.sap) are keyed by their host. */
export const isCareerSiteHost = (ref: { slug: string; shard?: string }) => !ref.shard && ref.slug.includes(".") && HOST.test(ref.slug);

/** A Taleo Business Edition pod and careers section: "{pod}.tbe.taleo.net/{section}". */
export const TALEO_BE_SHARD = /^([a-z]+\d*)\.tbe\.taleo\.net\/([a-z]+\d+)$/i;

/** The careers-site address for a board (the dispatcher when its pod isn't known). */
export function taleoBeUrl(c: { slug: string; shard?: string; site?: string }): string {
  const org = encodeURIComponent(c.slug);
  if (c.shard && TALEO_BE_SHARD.test(c.shard) && c.site) return `https://${c.shard}/ats/careers/v2/jobSearch?org=${org}&cws=${encodeURIComponent(c.site)}`;
  return taleoBeDispatcher(c);
}

/** TBE's dispatcher, which redirects to the board's current pod and careers site. */
export const taleoBeDispatcher = (c: { slug: string; shard?: string; site?: string }) =>
  `https://${c.shard?.match(TALEO_BE_SHARD)?.[1] ?? "phh"}.tbe.taleo.net/dispatcher/servlet/DispatcherServlet?org=${encodeURIComponent(c.slug)}&act=redirectCws&cws=${encodeURIComponent(c.site || "1")}`;

/** The public careers page for a board (the same address the company directory uses), or "" when it can't be rebuilt from the slug. */
export function careersUrl(c: DetectedCompany): string {
  switch (c.ats) {
    case "greenhouse":
      return `https://job-boards${c.region === "eu" ? ".eu" : ""}.greenhouse.io/${c.slug}`;
    case "lever":
      return `https://jobs${c.region === "eu" ? ".eu" : ""}.lever.co/${c.slug}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${c.slug}`;
    case "smartrecruiters":
      return `https://careers.smartrecruiters.com/${c.slug}`;
    case "workday":
      return `https://${c.slug}.${c.shard}.myworkdayjobs.com/${c.site ?? ""}`;
    case "workable":
      return `https://apply.workable.com/${c.slug}`;
    case "teamtailor":
      return `${teamtailorBase(c.slug)}/jobs`;
    case "comeet":
      return c.site ? `https://www.comeet.com/jobs/${c.site}/${c.slug}` : "";
    case "recruitee":
      return `https://${c.slug}.recruitee.com`;
    case "bamboohr":
      return `https://${c.slug}.bamboohr.com/careers`;
    case "breezy":
      return `https://${c.slug}.breezy.hr`;
    case "pinpoint":
      return `https://${c.slug}.pinpointhq.com`;
    case "jobvite":
      return `https://jobs.jobvite.com/${c.slug}`;
    case "rippling":
      return `https://ats.rippling.com/${c.slug}/jobs`;
    case "personio":
      return `https://${c.slug}.jobs.personio.com`;
    case "jazzhr":
      return `https://${c.slug}.applytojob.com/apply`;
    case "zoho":
      return `${zohoHost(c)}/jobs/${c.site ?? "Careers"}`;
    case "hibob":
      return `https://${c.slug}.careers.hibob.com`;
    case "freshteam":
      return `https://${c.slug}.freshteam.com/jobs`;
    case "join":
      return `https://join.com/companies/${c.slug}`;
    case "icims":
      return `https://${c.slug}.icims.com/jobs`;
    case "taleo":
      return c.site ? `https://${c.slug}.taleo.net/careersection/${c.site}/jobsearch.ftl` : "";
    case "oracle":
      return c.shard ? `https://${c.slug}.fa.${c.shard}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${c.site ?? "CX_1"}` : "";
    case "successfactors":
      if (isCareerSiteHost(c)) return `https://${c.slug.toLowerCase()}/search/`;
      return c.shard ? `https://${c.shard}/career?company=${encodeURIComponent(c.slug)}` : "";
    case "paylocity":
      return `https://recruiting.paylocity.com/Recruiting/Jobs/All/${c.slug}`;
    case "paycom":
      return `https://www.paycomonline.net/v4/ats/web.php/portal/${c.slug}/career-page`;
    case "hireology":
      return `https://careers.hireology.com/${c.slug}`;
    case "ukg":
      return c.shard && c.site ? `https://${c.shard}/${c.slug}/JobBoard/${c.site}` : "";
    case "eightfold":
      return `https://${c.slug}/careers`;
    case "phenom":
      return `https://${c.slug}`;
    case "careerplug":
      return `https://${c.slug}.careerplug.com/jobs`;
    case "dayforce":
      return c.site ? `https://jobs.dayforcehcm.com/${c.shard ?? "en-US"}/${c.slug}/${c.site}` : "";
    case "adp":
      return c.site ? `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${c.slug}&ccId=${c.site}` : "";
    case "applicantpro":
      return `https://${c.slug}.${c.shard === "isolvedhire.com" ? "isolvedhire.com" : "applicantpro.com"}/jobs/`;
    case "paycor":
      return `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${c.slug}`;
    case "hiringthing":
      return `https://${c.slug}/`;
    case "manatal":
      return `https://www.careers-page.com/${c.slug}`;
    case "trakstar":
      return `https://${c.slug}.hire.trakstar.com/`;
    case "factorial":
      return `https://${c.slug}/`;
    case "gem":
      return `https://jobs.gem.com/${c.slug}`;
    case "hrmdirect":
      return `https://${c.slug}.hrmdirect.com/employment/`;
    case "softgarden":
      return `https://${c.slug}.career.softgarden.de/`;
    case "cornerstone":
      return `https://${c.slug}.csod.com/ux/ats/careersite/1/home?c=${c.slug}`;
    case "keka":
      return `https://${c.slug}.keka.com/careers`;
    case "taleobe":
      return taleoBeUrl(c);
    case "jobscore":
      return `https://careers.jobscore.com/careers/${c.slug}`;
    case "avature":
      return `https://${c.slug}.avature.net/${c.site || "careers"}/SearchJobs/`;
    case "pageup":
      return `https://careers.pageuppeople.com/${c.slug}/${c.site || "cw/en"}/listing/`;
    case "radancy":
      return `https://${c.slug}/`;
    case "oleeo":
      return `https://${c.slug}.tal.net/vx/lang-en-GB/candidate/jobboard/vacancy/${c.site || "1"}/adv/`;
    case "jobtrain":
      return `https://${c.slug}/`;
    case "varbi":
      return `https://${c.slug}.varbi.com/`;
    case "jobylon":
      return `https://emp.jobylon.com/companies/${c.slug}/`;
    case "homerun":
      return `https://${c.slug}.homerun.co/`;
    case "emply":
      return `https://${c.slug}.career.emply.com/`;
    case "bullhorn":
      return c.site ? `https://${c.site}/` : "";
    case "hrmos":
      return `https://hrmos.co/pages/${c.slug}/jobs`;
    case "herp":
      return `https://herp.careers/v1/${c.slug}`;
    case "engage":
      return `https://en-gage.net/${c.slug}/`;
    default:
      return "";
  }
}

/**
 * Company directory key: "ats:slug", or "workday:tenant|shard|site", or "taleo:host|section" (a
 * Taleo pod hosts many companies, told apart by section). Lowercase.
 */
export function companyKey(c: { ats: string; slug: string; shard?: string; site?: string }): string {
  if (c.ats === "workday") return `workday:${c.slug}|${c.shard}|${c.site}`.toLowerCase();
  if (c.ats === "taleo" && c.site) return `taleo:${c.slug}|${c.site}`.toLowerCase();
  return `${c.ats}:${c.slug}`.toLowerCase();
}
