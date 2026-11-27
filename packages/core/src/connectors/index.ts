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
import { factorial } from "./factorial";
import { gem } from "./gem";
import { hrmdirect } from "./hrmdirect";
import { softgarden } from "./softgarden";
import { cornerstone } from "./cornerstone";
import { keka } from "./keka";
import { taleobe } from "./taleobe";
import { jobscore } from "./jobscore";
import { avature } from "./avature";
import { pageup } from "./pageup";
import { radancy } from "./radancy";
import { oleeo } from "./oleeo";
import { jobtrain } from "./jobtrain";
import { varbi } from "./varbi";
import { reachmee } from "./reachmee";
import { jobylon } from "./jobylon";
import { homerun } from "./homerun";
import { emply } from "./emply";
import { bullhorn } from "./bullhorn";
import { hrmos } from "./hrmos";
import { herp } from "./herp";
import { engage } from "./engage";
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
import { successfactors } from "./successfactors";
import { taleo } from "./taleo";
import { teamtailor } from "./teamtailor";
import { arbeitnow } from "./arbeitnow";
import { hackernews } from "./hackernews";
import { himalayas } from "./himalayas";
import { jobicy } from "./jobicy";
import { weworkremotely } from "./weworkremotely";
import { remotefirstjobs } from "./remotefirstjobs";
import { remoteok } from "./remoteok";
import { remotive } from "./remotive";
import type { Connector, DetectedCompany } from "./types";
import { workable } from "./workable";
import { workday } from "./workday";
import { zoho } from "./zoho";

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
  factorial,
  gem,
  hrmdirect,
  softgarden,
  cornerstone,
  keka,
  taleobe,
  jobscore,
  avature,
  pageup,
  radancy,
  oleeo,
  jobtrain,
  varbi,
  reachmee,
  jobylon,
  homerun,
  emply,
  bullhorn,
  hrmos,
  herp,
  engage,
  // Job boards (JOB_BOARDS), last so a company's own board is always recognised first.
  hackernews,
  remotive,
  arbeitnow,
  remoteok,
  himalayas,
  jobicy,
  weworkremotely,
  remotefirstjobs,
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

export { careersUrl, companyKey, SUPPORTED_ATS } from "./keys";

export type { Connector, Ctx, DetectedCompany } from "./types";
export { companyOfJobId, currentJobId, jobCompanyKey } from "./types";
