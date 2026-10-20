/**
 * Searches that find people at a company: LinkedIn people and post searches, and Blind. Pure. Every
 * part taken from a job, a CSV or your profile is encoded, and every result goes through safeUrl.
 * Opening one is a plain visit: those sites see what you searched for, RawJobs sends nothing.
 */
import { safeUrl } from "@rawjobs/core/text";

export type SearchLink = { id: string; label: string; href: string };

const PEOPLE = "https://www.linkedin.com/search/results/people/";
const quoted = (s: string) => `"${s.replace(/"/g, "").trim()}"`;
const enc = encodeURIComponent;

function people(keywords: string, network?: string[]): string {
  const q = `?keywords=${enc(keywords)}${network ? `&network=${enc(JSON.stringify(network))}` : ""}`;
  return `${PEOPLE}${q}`;
}

function link(id: string, label: string, href: string): SearchLink[] {
  const safe = safeUrl(href);
  return safe ? [{ id, label, href: safe }] : [];
}

/** Your 1st and 2nd connections at the company, and the 2nd ones alone. */
export function friendsSearch(company: string): string {
  return people(quoted(company), ["F", "S"]);
}

export type LinkInputs = {
  company: string;
  /** The job's title, for "people in this role". */
  title: string;
  /** Your schools (Education.csv), at most 2 used. */
  schools?: readonly string[];
  /** Your past employers (Positions.csv and your profile), at most 3 used. */
  pastEmployers?: readonly string[];
};

/** People one step away: friends of friends, alumni and past colleagues who work there now. */
export function warmLinks({ company, schools = [], pastEmployers = [] }: LinkInputs): SearchLink[] {
  const c = quoted(company);
  const uniq = (xs: readonly string[]) => [...new Map(xs.map((x) => [x.trim().toLowerCase(), x.trim()])).values()].filter(Boolean);
  return [
    ...link("friends", "Your 1st and 2nd connections there", friendsSearch(company)),
    ...link("second", "Friends of friends there", people(c, ["S"])),
    ...uniq(schools)
      .slice(0, 2)
      .flatMap((s, i) => link(`school-${i}`, `People from ${s}`, people(`${c} ${quoted(s)}`))),
    ...uniq(pastEmployers)
      .filter((p) => p.toLowerCase() !== company.trim().toLowerCase())
      .slice(0, 3)
      .flatMap((p, i) => link(`past-${i}`, `People who also worked at ${p}`, people(`${c} ${quoted(p)}`))),
  ];
}

/** Anyone there: people in this role, recruiters, hiring posts and Blind's referral threads. */
export function coldLinks({ company, title }: LinkInputs): SearchLink[] {
  const c = quoted(company);
  return [
    ...link("role", "People in this role", people(`${c} ${title.trim()}`)),
    ...recruiterLinks(company),
    ...link("posts", "Hiring posts from the last month", `https://www.linkedin.com/search/results/content/?keywords=${enc(`${c} hiring`)}&datePosted=${enc('"past-month"')}`),
    ...link("blind", "Referral threads on Blind", `https://www.teamblind.com/search/${enc(`${company.trim()} referral`)}`),
  ];
}

/** Recruiters at the company (also the only search for an agency's posting). */
export function recruiterLinks(company: string): SearchLink[] {
  return link("recruiters", "Recruiters there", people(`${quoted(company)} (recruiter OR "talent acquisition")`));
}

/** A LinkedIn profile link from the export: https://www.linkedin.com/in/<slug> only. */
export function profileHref(url: string | undefined): string | undefined {
  const safe = safeUrl(url);
  if (!safe) return undefined;
  const u = new URL(safe);
  return u.protocol === "https:" && (u.hostname === "www.linkedin.com" || u.hostname === "linkedin.com") && /^\/in\/[^/]+\/?$/.test(u.pathname) ? safe : undefined;
}
