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

/**
 * Where "Open LinkedIn beside this" goes: the company's People page searched for the role when its
 * LinkedIn slug is known, else a people search for the company and the role.
 */
export function seePeopleHref({ company, title, slug }: { company: string; title: string; slug?: string }): string {
  const s = slug?.trim();
  if (s && /^[\w-]{1,100}$/.test(s)) return `https://www.linkedin.com/company/${enc(s)}/people/?keywords=${enc(title.trim())}`;
  return people(`${quoted(company)} ${title.trim()}`);
}

/**
 * A profile link you paste ("linkedin.com/in/ada-lovelace?trk=…"), cleaned to
 * https://www.linkedin.com/in/<slug>. Anything that isn't a /in/ profile on linkedin.com is refused:
 * the contact check (linkedInUrl) alone accepts any LinkedIn page.
 */
export function profileLink(input: string): string | undefined {
  const s = input.trim();
  if (!s || s.length > 300 || /\s/.test(s)) return undefined;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return undefined;
  }
  if (u.hostname !== "linkedin.com" && !u.hostname.endsWith(".linkedin.com")) return undefined;
  const m = u.pathname.match(/^\/in\/([^/]+)\/?$/);
  return m ? profileHref(`https://www.linkedin.com/in/${m[1]}`) : undefined;
}

/** A name from a profile link's slug ("ada-lovelace-1a2b3c" is "Ada Lovelace"), for someone logged without one. */
export function nameFromProfile(url: string): string | undefined {
  let slug = "";
  try {
    slug = decodeURIComponent(new URL(url).pathname.split("/")[2] ?? "");
  } catch {
    return undefined;
  }
  const words = slug
    .split(/[-_]+/)
    .filter((w) => /^\p{L}+$/u.test(w))
    .slice(0, 3);
  return words.length ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : undefined;
}

/**
 * A company's name as a URL slug: lower case, accents dropped, every run of spaces or punctuation
 * one hyphen ("Procter & Gamble" is "procter-gamble", "AT&T" is "at-t"). Letters in other scripts stay.
 */
export function companySlug(company: string): string {
  return company
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** Where to book a call for advice: ADPList's free mentors at the company and Topmate's search. Plain new-tab links. */
export function callLinks(company: string): SearchLink[] {
  const slug = companySlug(company);
  if (!slug) return [];
  const name = company.trim();
  return [...link("adplist", `Free mentors at ${name}`, `https://adplist.org/mentors/company/${enc(slug)}`), ...link("topmate", "Paid calls on Topmate", `https://topmate.io/s/${enc(slug)}`)];
}
