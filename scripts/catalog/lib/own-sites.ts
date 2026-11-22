/**
 * Workday companies' own careers sites (own-sites.ts): which company websites to read for each
 * Workday tenant, and whether a board found there is the same company's. Pure, so it can be tested.
 */
import { domainLabel } from "./wikidata";

/** One Workday tenant ({tenant}.{shard}.myworkdayjobs.com) and its boards in the directory. */
export type Tenant = {
  /** "tenant|shard", lower case. */
  id: string;
  tenant: string;
  /** Directory keys of its live boards, most open jobs first. */
  boards: string[];
  /** Open jobs on its biggest board at the last definite check. */
  jobs: number;
  /** Company websites to read, best first, with the name the website's source gives the company. */
  websites: { website: string; name: string; from: "resolved" | "wikidata" | "tenant" }[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Labels shorter than this ("ge", "ngc", "bah") match too much by accident. */
const MIN_LABEL = 4;

/** "workday:acme|wd5|external" -> its tenant id "acme|wd5", or undefined for another system's key. */
export function workdayTenantOf(key: string): { id: string; tenant: string } | undefined {
  const m = key.match(/^workday:([^|]+)\|([^|]+)\|/);
  return m ? { id: `${m[1]}|${m[2]}`.toLowerCase(), tenant: m[1]!.toLowerCase() } : undefined;
}

/** Whether a website is the tenant's company itself: its domain name and the tenant contain one another ("7eleven", "my7elevenhr"). */
export const isTenantSite = (tenant: string, website: string): boolean => {
  const t = norm(tenant);
  const l = domainLabel(website);
  return l.length >= MIN_LABEL && t.length >= MIN_LABEL && (t.includes(l) || l.includes(t));
};

/**
 * The names a board of this company would carry: the tenant and the domain names of the websites that
 * are the tenant's company ("adobe" for adobe.com). A subsidiary's website that led to the parent's
 * tenant (marketo.com for Adobe's) is read, but its name doesn't count: its own careers site isn't the
 * parent's. Only when the tenant is too short to judge ("ghr") do all its websites' names count.
 */
export function ownerLabels(t: Pick<Tenant, "tenant" | "websites">): string[] {
  const tenant = norm(t.tenant);
  const sites = tenant.length >= MIN_LABEL ? t.websites.filter((w) => isTenantSite(tenant, w.website)) : t.websites;
  return [...new Set([tenant, ...sites.map((w) => domainLabel(w.website))])].filter((l) => l.length >= MIN_LABEL);
}

/**
 * Whether a board belongs to the company: its host (careers.adobe.com, jobs.disneycareers.com,
 * explore.jobs.netflix.net) or its id on a hiring system's host (careers-cvshealth.icims.com,
 * mastercard.avature.net) contains one of the company's names. Keeps a page's links to partners,
 * parents and job boards out.
 */
export function ownedBy(board: { slug: string }, labels: readonly string[]): boolean {
  const id = board.slug.includes(".") ? domainLabel(board.slug) : norm(board.slug);
  return !!id && labels.some((l) => id.includes(l));
}

/** A link on a careers page we follow: on a host the company owns, and about jobs. */
export function ownCareersLink(url: string, labels: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  return ownedBy({ slug: u.hostname }, labels) && /career|jobs?\b|join|vacanc|opportunit/i.test(`${u.hostname}${u.pathname}`);
}

type Resolved = { name: string; website: string; board?: { key: string }; also?: string[] };
type WikidataCompany = { name: string; website: string };

/**
 * Workday tenants with a live board and the company websites to read for each:
 * 1. websites whose careers page led to the tenant (resolve.ts found it there),
 * 2. the one Wikidata company whose domain name is the tenant ("lowes" for lowes.com),
 * 3. else {tenant}.com, for tenants long enough to be a name.
 * Biggest tenants first.
 */
export function planTenants(checks: ReadonlyMap<string, { status: string; jobs?: unknown }>, resolved: readonly Resolved[], wikidata: readonly WikidataCompany[]): Tenant[] {
  const tenants = new Map<string, Tenant & { counts: Map<string, number> }>();
  for (const [key, c] of checks) {
    const t = workdayTenantOf(key);
    if (!t || c.status !== "live") continue;
    const jobs = typeof c.jobs === "number" ? c.jobs : 0;
    const prev = tenants.get(t.id) ?? { ...t, boards: [], jobs: 0, websites: [], counts: new Map() };
    prev.counts.set(key, jobs);
    prev.jobs = Math.max(prev.jobs, jobs);
    tenants.set(t.id, prev);
  }
  for (const r of resolved) {
    for (const key of [r.board?.key, ...(r.also ?? [])]) {
      const t = key && workdayTenantOf(key);
      const tenant = t && tenants.get(t.id);
      if (tenant && r.website && !tenant.websites.some((w) => w.website === r.website)) tenant.websites.push({ website: r.website, name: r.name, from: "resolved" });
    }
  }
  const byLabel = new Map<string, WikidataCompany[]>();
  for (const w of wikidata) {
    const l = domainLabel(w.website);
    if (l.length >= MIN_LABEL) byLabel.set(l, [...(byLabel.get(l) ?? []), w]);
  }
  const out: Tenant[] = [];
  for (const { counts, ...t } of tenants.values()) {
    const label = norm(t.tenant);
    const wiki = byLabel.get(label);
    if (wiki?.length === 1 && !t.websites.some((w) => domainLabel(w.website) === label)) t.websites.push({ website: wiki[0]!.website, name: wiki[0]!.name, from: "wikidata" });
    if (!t.websites.length && label.length >= 5 && label === t.tenant) t.websites.push({ website: `https://${label}.com/`, name: "", from: "tenant" });
    // The website named like the tenant first: a subsidiary's site (marketo.com for Adobe) is the fallback.
    t.websites.sort((a, b) => Number(domainLabel(b.website) === label) - Number(domainLabel(a.website) === label));
    t.boards = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    out.push(t);
  }
  return out.sort((a, b) => b.jobs - a.jobs || a.id.localeCompare(b.id));
}

/**
 * `same_as` links for publish.ts: each live own careers site leads its company, and the Workday boards
 * it stands in for point to it. A site already joined to another board (sameAsLinks) keeps that lead;
 * sites no longer live in the directory link nothing.
 */
export function ownSiteLinks(sites: readonly { key: string; replaces?: readonly string[] }[], live: ReadonlySet<string>, sameAs: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sites) {
    if (!live.has(s.key) || !s.replaces?.length) continue;
    const lead = sameAs.get(s.key) ?? s.key;
    out.set(s.key, lead);
    for (const k of s.replaces) if (k !== lead) out.set(k, lead);
  }
  return out;
}
