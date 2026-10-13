/**
 * freehire's board list (strelov1/freehire, MIT). freehire kept its boards in `sources/*.yml` until
 * 2026-09-04, then moved them into a database (#2406), so sources.ts downloads the last committed
 * copy, pinned to that commit, and merge.ts turns each entry into a board with freehireBoards().
 */
import { detectCompany, isCareerSiteHost, isTeamtailorHost } from "@rawjobs/core";

/** The parent of freehire's "Retire sources/" commit (2b781bf5, #2406): the last one with the list. */
export const FREEHIRE_COMMIT = "96b53a2c7b1e545bbad0868e16ec85a2eba4f36a";

const enc = encodeURIComponent;
const plain = (s: string) => /^[a-z0-9._-]+$/i.test(s);

/** freehire's `board` id per provider (its file names) -> a careers URL our own detection reads. */
export const BOARD_URL: Record<string, (b: string) => string | undefined> = {
  ashby: (b) => `https://jobs.ashbyhq.com/${enc(b)}`,
  bamboohr: (b) => (plain(b) ? `https://${b}.bamboohr.com/careers` : undefined),
  breezy: (b) => (plain(b) ? `https://${b}.breezy.hr` : undefined),
  // "{company}/{uid}"
  // The account subdomain of {account}.careerplug.com
  careerplug: (b) => (plain(b) && !b.includes(".") ? `https://${b}.careerplug.com/jobs` : undefined),
  comeet: (b) => (b.includes("/") ? `https://www.comeet.com/jobs/${b.split("/").map(enc).join("/")}` : undefined),
  // The account subdomain of {account}.applicantpro.com / {account}.isolvedhire.com (the same platform)
  applicantpro: (b) => (plain(b) && !b.includes(".") ? `https://${b}.applicantpro.com/jobs/` : undefined),
  isolvedhire: (b) => (plain(b) && !b.includes(".") ? `https://${b}.isolvedhire.com/jobs/` : undefined),
  // "{cid}:{ccId}" of an ADP Workforce Now career center
  adp: (b) => {
    const [cid, ccId] = b.split(":");
    return cid && ccId && plain(cid) && plain(ccId) ? `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${cid}&ccId=${ccId}` : undefined;
  },
  // "{tenant}/{site}[/{culture}]" on jobs.dayforcehcm.com
  dayforce: (b) => {
    const [tenant, site, culture] = b.split("/");
    return tenant && site && plain(tenant) && plain(site) ? `https://jobs.dayforcehcm.com/${culture && /^[a-z]{2}-[A-Z]{2}$/.test(culture) ? culture : "en-US"}/${tenant}/${site}` : undefined;
  },
  // "{host}/{tenant domain}"; kept as a board directly in freehireBoards (custom hosts included).
  eightfold: () => undefined,
  freshteam: (b) => (plain(b) ? `https://${b}.freshteam.com/jobs` : undefined),
  greenhouse: (b) => `https://job-boards.greenhouse.io/${enc(b)}`,
  // The tenant slug of careers.hireology.com/{slug}
  hireology: (b) => (plain(b) && !b.includes(".") ? `https://careers.hireology.com/${b}` : undefined),
  // The careers site host ({tenant}.hiringthing.com or a reseller domain)
  hiringthing: (b) => (plain(b) && b.includes(".") ? `https://${b}/` : undefined),
  hibob: (b) => (plain(b) ? `https://${b}.careers.hibob.com` : undefined),
  // A bare id is the careers-{id}.icims.com portal; full hosts are companies' own domains (not detectable yet).
  icims: (b) => (plain(b) && !b.includes(".") ? `https://careers-${b}.icims.com/jobs` : undefined),
  jazzhr: (b) => (plain(b) ? `https://${b}.applytojob.com/apply` : undefined),
  jobvite: (b) => `https://jobs.jobvite.com/${enc(b)}`,
  lever: (b) => `https://jobs.lever.co/${enc(b)}`,
  // "{host}/{siteNumber}"
  // The careers page name of www.careers-page.com/{slug}
  manatal: (b) => (plain(b) && !b.includes(".") ? `https://www.careers-page.com/${b}` : undefined),
  oracle: (b) => {
    const [host, site] = b.split("/");
    return host && site && plain(host) ? `https://${host}/hcmUI/CandidateExperience/en/sites/${enc(site)}` : undefined;
  },
  // The 32-hex client key of paycomonline.net/v4/ats/web.php/portal/{key}
  paycom: (b) => (/^[0-9a-f]{32}$/i.test(b) ? `https://www.paycomonline.net/v4/ats/web.php/portal/${b}/career-page` : undefined),
  // The company GUID of recruiting.paylocity.com/Recruiting/Jobs/All/{guid}
  paylocity: (b) => (/^[0-9a-f-]{36}$/i.test(b) ? `https://recruiting.paylocity.com/Recruiting/Jobs/All/${b}` : undefined),
  // The careers site's host; kept as a board directly in freehireBoards.
  phenom: () => undefined,
  // The 32-hex clientId of recruitingbypaycor.com/career/CareerHome.action?clientId={id}
  paycor: (b) => (/^[0-9a-f]{32}$/i.test(b) ? `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${b}` : undefined),
  personio: (b) => (plain(b) ? `https://${b}.jobs.personio.com` : undefined),
  pinpoint: (b) => (plain(b) ? `https://${b}.pinpointhq.com` : undefined),
  recruitee: (b) => (plain(b) ? `https://${b}.recruitee.com` : undefined),
  rippling: (b) => `https://ats.rippling.com/${enc(b)}/jobs`,
  smartrecruiters: (b) => `https://jobs.smartrecruiters.com/${enc(b)}`,
  // The SAP SuccessFactors career-site host (RMK); kept as the board in freehireBoards.
  successfactors: (b) => (plain(b) ? `https://${b}` : undefined),
  // The career-site host: {x}.teamtailor.com, or the company's own domain (handled in freehireBoards).
  teamtailor: (b) => (plain(b) ? `https://${b}` : undefined),
  // The account subdomain of {account}.hire.trakstar.com
  trakstar: (b) => (plain(b) && !b.includes(".") ? `https://${b}.hire.trakstar.com/` : undefined),
  // "{host}/{company code}/{board GUID}" of UKG Pro Recruiting
  ukg: (b) => {
    const [host, code, guid] = b.split("/");
    return host && code && guid && plain(host) && plain(code) && plain(guid) ? `https://${host}/${code}/JobBoard/${guid}` : undefined;
  },
  workable: (b) => `https://apply.workable.com/${enc(b)}`,
  // "{tenant}.wdN.myworkdayjobs.com/{site}" or "wdN.myworkdaysite.com/{tenant}/{site}"
  workday: (b) => {
    const [host, ...rest] = b.split("/");
    if (!host || !plain(host) || !rest.length) return undefined;
    return rest.length === 2 ? `https://${host}/recruiting/${rest.map(enc).join("/")}` : `https://${host}/${enc(rest[0]!)}`;
  },
  // The full host, e.g. acme.zohorecruit.in
  zohorecruit: (b) => (plain(b) ? `https://${b}/jobs/Careers` : undefined),
};

export type FreehireBoard = { ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string };

/** One provider file's entries -> the boards our detection recognises. */
export function freehireBoards(provider: string, entries: { company?: unknown; board?: unknown }[]): FreehireBoard[] {
  const toUrl = BOARD_URL[provider];
  if (!toUrl) return [];
  const out: FreehireBoard[] = [];
  for (const e of entries) {
    if (typeof e.board !== "string" || !e.board.trim()) continue;
    const name = typeof e.company === "string" ? e.company.trim() : "";
    const board = e.board.trim();
    // A Teamtailor site on the company's own domain: the list names the vendor, the URL can't.
    if (provider === "phenom") {
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(board)) out.push({ ats: "phenom", slug: board.toLowerCase(), ...(name ? { name } : {}) });
      continue;
    }
    if (provider === "eightfold") {
      const [host, domain] = board.split("/");
      if (host && domain && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain))
        out.push({ ats: "eightfold", slug: host.toLowerCase(), shard: domain.toLowerCase(), ...(name ? { name } : {}) });
      continue;
    }
    if (provider === "successfactors" && isCareerSiteHost({ slug: board }) && !/(^|\.)(successfactors|sapsf)\.(com|eu|cn)$/i.test(board)) {
      out.push({ ats: "successfactors", slug: board.toLowerCase(), ...(name ? { name } : {}) });
      continue;
    }
    if (provider === "teamtailor" && isTeamtailorHost(board) && !/\.teamtailor\.com$/i.test(board)) {
      out.push({ ats: "teamtailor", slug: board.toLowerCase(), ...(name ? { name } : {}) });
      continue;
    }
    const url = toUrl(board);
    const d = url ? detectCompany(url) : null;
    if (!d?.supported) continue;
    out.push({ ats: d.ats, slug: d.slug, ...(d.region ? { region: d.region } : {}), ...(d.shard ? { shard: d.shard } : {}), ...(d.site ? { site: d.site } : {}), ...(name ? { name } : {}) });
  }
  return out;
}
