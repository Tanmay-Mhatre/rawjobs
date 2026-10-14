import { companyNameKey, fromJobBoard, roleKey } from "@rawjobs/core/dashboard";
import type { Job } from "./data";

/**
 * Which company a posting is at, for grouping: not its name (two different "Linear"s share one), but its
 * board. In order: the directory's same-company link (`identity`: boards of one company on several
 * hiring systems), then the company's own key ("greenhouse:acme"). Job boards' copies get one only from
 * attachFeedJobs(). Data saved before companyKey existed falls back to the name, and groups as it did.
 */
export function identityOf(j: Pick<Job, "company" | "identity" | "companyKey" | "ats">): string {
  if (j.identity) return j.identity;
  if (fromJobBoard(j)) return `feed:${companyNameKey(j.company)}`;
  return j.companyKey ?? `name:${companyNameKey(j.company)}`;
}

/** One role at one company: the key the Radar groups postings by. */
export const roleOf = (j: Pick<Job, "company" | "identity" | "companyKey" | "ats" | "title">) => `${identityOf(j)}|${roleKey(j.title)}`;

const isRemote = (j: Job) => j.workplace === "remote" || /\bremote\b/i.test(j.location);
const noPlace = (j: Job) => !j.countries.length && !j.cities.length && !isRemote(j);

/** Could two postings be the same opening? Both remote, a shared country or city, or one names no place. */
export function placesFit(a: Job, b: Job): boolean {
  if (noPlace(a) || noPlace(b)) return true;
  if (isRemote(a) && isRemote(b)) return true;
  return a.countries.some((c) => b.countries.includes(c)) || a.cities.some((c) => b.cities.includes(c));
}

/**
 * Job boards (Remotive, Himalayas…) copy companies' jobs under the company's name. A copy joins the
 * company only on proof: exactly one company on the list has that name (two "Acme"s: no join), it
 * posts the same role, and the places fit. Otherwise it stays its own company ("feed:acme"), so two
 * boards' copies of one job still group with each other. Returns the list with `identity` set on the
 * copies that joined; everything else is left as it is.
 */
export function attachFeedJobs(jobs: readonly Job[]): Job[] {
  const companies = new Map<string, Set<string>>();
  const roles = new Map<string, Job[]>();
  for (const j of jobs) {
    if (fromJobBoard(j)) continue;
    const id = identityOf(j);
    const name = companyNameKey(j.company);
    companies.set(name, (companies.get(name) ?? new Set()).add(id));
    const role = `${id}|${roleKey(j.title)}`;
    roles.set(role, [...(roles.get(role) ?? []), j]);
  }
  return jobs.map((j) => {
    if (!fromJobBoard(j) || j.identity) return j;
    const ids = companies.get(companyNameKey(j.company));
    if (ids?.size !== 1) return j;
    const [id] = ids;
    const same = roles.get(`${id}|${roleKey(j.title)}`);
    return same?.some((o) => placesFit(o, j)) ? { ...j, identity: id } : j;
  });
}
