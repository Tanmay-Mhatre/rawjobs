import type { AtsType, CompanyRef } from "../schema";
import { ashby } from "./ashby";
import { bamboohr } from "./bamboohr";
import { breezy } from "./breezy";
import { comeet } from "./comeet";
import { detectKnownAts } from "./detect-known";
import { freshteam } from "./freshteam";
import { join } from "./join";
import { paylocity } from "./paylocity";
import { paycom } from "./paycom";
import { hireology } from "./hireology";
import { ukg } from "./ukg";
import { eightfold } from "./eightfold";
import { phenom } from "./phenom";
import { careerplug } from "./careerplug";
import { dayforce } from "./dayforce";
import { adp } from "./adp";
import { applicantpro } from "./applicantpro";
import { paycor } from "./paycor";
import { hiringthing } from "./hiringthing";
import { manatal } from "./manatal";
import { trakstar } from "./trakstar";
import { greenhouse } from "./greenhouse";
import { hibob } from "./hibob";
import { icims } from "./icims";
import { jazzhr } from "./jazzhr";
import { jobvite } from "./jobvite";
import { lever } from "./lever";
import { oracle } from "./oracle";
import { personio } from "./personio";
import { pinpoint } from "./pinpoint";
import { recruitee } from "./recruitee";
import { rippling } from "./rippling";
import { smartrecruiters } from "./smartrecruiters";
import { isCareerSiteHost, successfactors } from "./successfactors";
import { taleo } from "./taleo";
import { teamtailor, teamtailorBase } from "./teamtailor";
import { arbeitnow } from "./arbeitnow";
import { hackernews } from "./hackernews";
import { remoteok } from "./remoteok";
import { remotive } from "./remotive";
import type { Connector, DetectedCompany } from "./types";
import { workable } from "./workable";
import { workday } from "./workday";
import { zoho, zohoHost } from "./zoho";

/** One connector per hiring system in ATS_TYPES. */
// biome-ignore lint/suspicious/noExplicitAny: each connector has its own raw posting type; the registry only routes to them
export const connectors: Partial<Record<AtsType, Connector<any>>> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  workable,
  recruitee,
  personio,
  bamboohr,
  breezy,
  successfactors,
  teamtailor,
  comeet,
  oracle,
  icims,
  taleo,
  jobvite,
  pinpoint,
  rippling,
  jazzhr,
  zoho,
  hibob,
  freshteam,
  join,
  paylocity,
  paycom,
  hireology,
  ukg,
  eightfold,
  phenom,
  careerplug,
  dayforce,
  adp,
  applicantpro,
  paycor,
  hiringthing,
  manatal,
  trakstar,
  // Job boards (JOB_BOARDS), last so a company's own board is always recognised first.
  hackernews,
  remotive,
  arbeitnow,
  remoteok,
};

export function getConnector(ats: AtsType): Connector<unknown> | undefined {
  return connectors[ats];
}

export type DetectResult = DetectedCompany & Pick<CompanyRef, "name"> & { /** false = recognised, connector not built yet */ supported: boolean };

/** Careers URL -> company line. Name is a guess from the slug; edit it. */
export function detectCompany(input: string): DetectResult | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  // Detection decodes URL parts; a malformed escape ("%E0%A4%A") just means "not a board".
  try {
    for (const c of Object.values(connectors)) {
      const found = c?.detect(url);
      if (found) return { name: c.label ?? guessName(nameSource(found)), ...found, supported: true };
    }
  } catch {
    return null;
  }
  let known: DetectedCompany | null;
  try {
    known = detectKnownAts(url);
  } catch {
    return null;
  }
  return known ? { name: guessName(nameSource(known)), ...known, supported: false } : null;
}

/** The part of a board address that names the company. */
function nameSource(d: DetectedCompany): string {
  if (d.ats === "comeet" && d.site) return d.site;
  if (d.ats === "icims") return d.slug.replace(/^(careers|jobs|uscareers|external|internal|careers\d*)-/i, "");
  return d.slug;
}

/**
 * Name from a board slug: "kraken.com" -> "Kraken", "acme-labs" -> "Acme Labs",
 * "AcmeLabs" -> "Acme Labs". Joined lowercase words ("dollartree") can't be split without a dictionary.
 */
export function guessName(slug: string): string {
  return slug
    .replace(/\.(com|io|ai|co|net|org|xyz|app|dev|tech)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+\d+$/, "")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

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

export type { Connector, Ctx, DetectedCompany } from "./types";
export { companyOfJobId, currentJobId, jobCompanyKey } from "./types";
