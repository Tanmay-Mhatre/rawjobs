import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toDashboardJob } from "./dashboard";
import { companyKey, connectors } from "./connectors";
import type { CompanyRef, DashboardJob, Profile, ScoreBreakdown, Workplace } from "./schema";
import { companyIndustries } from "./catalog/industries";
import { cleanVisa } from "./catalog/visa";
import { gateOf, rankScore, scoreJob } from "./score";
import { rowPostedAt, type IndexedCompany } from "./suggest";

/**
 * Jobs beyond the user's own companies.
 *
 * The shared directory's weekly index lists every open job (title, location, age) at ~14k companies.
 * Each scan gates it with the user's rules (no web requests), live-checks a few of the best companies
 * (full score, real apply link), and keeps the rest as index jobs with an estimated score: no description,
 * so no keyword points, and the link goes to the careers page.
 */

const DAY_MS = 86_400_000;
/** A company checked live isn't checked again for this long. */
export const CHECK_AGAIN_AFTER_DAYS = 7;
/** Jobs from a company checked live stay this long after its last check (then the index has it again). */
export const KEEP_CHECKED_DAYS = 30;
/** Index jobs written per scan, best first (very broad profiles can match tens of thousands). */
export const MAX_INDEX_JOBS = 1000;

export type IndexFile = { generated_at: string; companies: IndexedCompany[] };

/** One index row that passes the user's gates. */
export type Candidate = {
  company: IndexedCompany;
  title: string;
  location: string;
  workplace: Workplace;
  postedAt?: string;
  /** Postings merged into this row (same title and location). */
  count: number;
  /** Score without a description: title, location, industry and topics in the title only. */
  estimate: number;
  why: ScoreBreakdown;
};

/** A company checked live: when, and how it went (data/discovery.json). */
export type CheckedCompany = Pick<CompanyRef, "name" | "ats" | "slug" | "region" | "shard" | "site" | "careers_url"> & {
  lastChecked: string;
  /** Jobs there that passed the user's gates at the last check. */
  matches: number;
  error?: string;
};
export type DiscoveryLedger = { version: 1; companies: Record<string, CheckedCompany> };

/** data/discover.json: index jobs, for the dashboard. */
export type DiscoverFile = { version: 1; generatedAt: string; indexGeneratedAt: string; jobs: DashboardJob[] };

const keyOf = (c: Pick<CompanyRef, "ats" | "slug" | "shard" | "site">) => companyKey(c);

export function readIndex(dataDir: string): IndexFile | undefined {
  const path = join(dataDir, "catalog", "index.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as IndexFile) : undefined;
}

export function readLedger(dataDir: string): DiscoveryLedger {
  const path = join(dataDir, "discovery.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DiscoveryLedger) : { version: 1, companies: {} };
}

export function writeLedger(dataDir: string, ledger: DiscoveryLedger): void {
  writeFileSync(join(dataDir, "discovery.json"), JSON.stringify(ledger, null, 1));
}

/** Every index row that passes the user's title and location gates, best estimate first. */
export function findCandidates(profile: Profile, index: IndexFile, now = new Date()): Candidate[] {
  const generatedAt = new Date(index.generated_at);
  const out: Candidate[] = [];
  for (const company of index.companies) {
    const fetchedAt = company.fetched_at ? new Date(company.fetched_at) : generatedAt;
    for (const [title, location, wp, age, count] of company.rows) {
      const workplace = wp as Workplace;
      if (gateOf({ title, location, workplace }, profile)) continue;
      const postedAt = rowPostedAt(age, fetchedAt)?.toISOString();
      const { score, why } = scoreJob({ title, location, workplace, description: "" }, profile, { industries: companyIndustries(company) });
      out.push({ company, title, location, workplace, postedAt, count, estimate: score, why });
    }
  }
  // The Radar's order: fit, then freshness (the estimate has no age in it).
  const rank = new Map(out.map((c) => [c, rankScore(c.estimate, c.postedAt, now.getTime())]));
  return out.sort((a, b) => rank.get(b)! - rank.get(a)! || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

/** Companies whose jobs come from a live check, not the index: checked in the last KEEP_CHECKED_DAYS. */
export function keptChecked(ledger: DiscoveryLedger, now = new Date()): CompanyRef[] {
  const cutoff = now.getTime() - KEEP_CHECKED_DAYS * DAY_MS;
  return Object.values(ledger.companies)
    .filter((c) => Date.parse(c.lastChecked) >= cutoff)
    .map((c) => toRef(c));
}

const toRef = (c: Pick<CompanyRef, "name" | "ats" | "slug" | "region" | "shard" | "site" | "careers_url">): CompanyRef => ({
  name: c.name,
  ats: c.ats,
  slug: c.slug,
  ...(c.region ? { region: c.region } : {}),
  ...(c.shard ? { shard: c.shard } : {}),
  ...(c.site ? { site: c.site } : {}),
  ...(c.careers_url ? { careers_url: c.careers_url } : {}),
  enabled: true,
});

/**
 * Companies to check live this scan: not yours, not muted, on a hiring system we can read, and not
 * checked in the last CHECK_AGAIN_AFTER_DAYS. Best candidate job first, then the freshest.
 */
export function pickChecks(candidates: readonly Candidate[], opts: { tracked: ReadonlySet<string>; muted: ReadonlySet<string>; ledger: DiscoveryLedger; limit: number; now?: Date }): CompanyRef[] {
  const now = (opts.now ?? new Date()).getTime();
  const out: CompanyRef[] = [];
  const seen = new Set<string>();
  // Candidates are sorted best first, so a company's first row is its best.
  for (const c of candidates) {
    if (out.length >= opts.limit) break;
    const key = c.company.key;
    if (seen.has(key)) continue;
    seen.add(key);
    if (opts.tracked.has(key) || opts.muted.has(key) || !connectors[c.company.ats as CompanyRef["ats"]]) continue;
    const last = opts.ledger.companies[key]?.lastChecked;
    if (last && now - Date.parse(last) < CHECK_AGAIN_AFTER_DAYS * DAY_MS) continue;
    out.push(companyRefOf(c.company));
  }
  return out;
}

/** An index company as a company to fetch. */
export const companyRefOf = (c: IndexedCompany): CompanyRef => toRef({ ...c, ats: c.ats as CompanyRef["ats"], region: c.region as CompanyRef["region"] });

/** Record this scan's live checks in the ledger (failures too, so a broken board isn't retried every scan). */
export function recordChecks(
  ledger: DiscoveryLedger,
  checked: readonly CompanyRef[],
  health: readonly { ats: string; slug: string; ok: boolean; matches: number; error?: string }[],
  now = new Date(),
): DiscoveryLedger {
  const companies = { ...ledger.companies };
  const cutoff = now.getTime() - KEEP_CHECKED_DAYS * DAY_MS;
  for (const [k, c] of Object.entries(companies)) if (Date.parse(c.lastChecked) < cutoff) delete companies[k];
  for (const c of checked) {
    const h = health.find((x) => x.ats === c.ats && x.slug === c.slug);
    if (!h) continue;
    companies[keyOf(c)] = {
      name: c.name,
      ats: c.ats,
      slug: c.slug,
      ...(c.region ? { region: c.region } : {}),
      ...(c.shard ? { shard: c.shard } : {}),
      ...(c.site ? { site: c.site } : {}),
      ...(c.careers_url ? { careers_url: c.careers_url } : {}),
      lastChecked: now.toISOString(),
      matches: h.matches,
      ...(h.ok ? {} : { error: h.error ?? "failed" }),
    };
  }
  return { version: 1, companies };
}

/** A short stable hash, for index job ids. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Index jobs for the dashboard: candidates at companies that aren't live (not yours, not checked
 * recently, not muted), best first, at most `limit`. Ids are stable across scans: index:{company}:{hash}.
 */
export function toIndexJobs(candidates: readonly Candidate[], opts: { live: ReadonlySet<string>; muted: ReadonlySet<string>; indexGeneratedAt: string; limit?: number }): DashboardJob[] {
  const out: DashboardJob[] = [];
  for (const c of candidates) {
    if (out.length >= (opts.limit ?? MAX_INDEX_JOBS)) break;
    const key = c.company.key;
    if (opts.live.has(key) || opts.muted.has(key)) continue;
    const seen = c.postedAt ?? opts.indexGeneratedAt;
    out.push({
      ...toDashboardJob({
        id: `index:${key}:${hash(`${c.title}\u0000${c.location}`)}`,
        ats: c.company.ats as CompanyRef["ats"],
        company: c.company.name,
        title: c.title,
        location: c.location,
        workplace: c.workplace,
        postedAt: c.postedAt,
        url: c.company.careers_url,
        firstSeen: seen,
        lastSeen: opts.indexGeneratedAt,
        status: "open",
        score: c.estimate,
        why: c.why,
      }),
      estimated: true,
      companyKey: key,
      ...(c.company.tags?.length ? { industries: c.company.tags } : {}),
      ...(cleanVisa(c.company.visa) ? { visa: cleanVisa(c.company.visa) } : {}),
    });
  }
  return out;
}

export function writeDiscover(dataDir: string, file: DiscoverFile): void {
  writeFileSync(join(dataDir, "discover.json"), JSON.stringify(file));
}
