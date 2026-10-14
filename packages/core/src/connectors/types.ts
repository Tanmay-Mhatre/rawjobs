import type { HttpClient } from "../http";
import type { AtsType, CompanyRef, Job, NormalizedJob } from "../schema";

export type Ctx = {
  http: HttpClient;
  now: Date;
  /**
   * fetch() calls this when it stopped before the end of the list (a page or posting cap): the
   * jobs it didn't reach aren't gone, so the run closes none of the company's unseen jobs.
   */
  partial?: () => void;
  /**
   * For paged lists: fetch() reports its first page (firstPageFingerprint of the total and the ids on
   * it). True means the board is as the last full read saw it: fetch() then stops paging and returns
   * just that page, and the run keeps the jobs from that read instead.
   */
  firstPage?: (fingerprint: string, total: number) => boolean;
};

/** A cheap fingerprint of a board's job ids (FNV-1a over the sorted ids): the same when the same jobs are listed. */
export function hashIds(ids: readonly string[]): string {
  const text = [...ids].sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** A paged list's first page: its total and the ids on it, in order (a new job lands on top, a closed one changes the total). */
export function firstPageFingerprint(total: number, ids: readonly string[]): string {
  return `${total}:${hashIds([ids.join("\n")])}`;
}

/** What detect() can read off a careers URL. */
export type DetectedCompany = Pick<CompanyRef, "ats" | "slug" | "region" | "shard" | "site">;

/** One per ATS. Keep fetch() to the fewest requests possible: one per company where the feed allows it. */
export interface Connector<Raw = unknown> {
  ats: AtsType;
  /** Careers URL -> company reference, or null if the URL isn't this ATS. No network. */
  detect(url: URL): DetectedCompany | null;
  /** All currently published jobs for the company. Throws on failure. */
  fetch(ref: CompanyRef, ctx: Ctx): Promise<Raw[]>;
  normalize(raw: Raw, ref: CompanyRef): NormalizedJob;
  /**
   * For ATSs whose list has no descriptions: fetch one job's description. The run calls this
   * only for jobs that already pass the title/location gates, so keyword scoring stays cheap.
   */
  describe?(raw: Raw, ref: CompanyRef, ctx: Ctx): Promise<string | JobDetail>;
  /**
   * For capped lists: the board's own keyword search, postings shaped like fetch()'s, at most
   * SEARCH_MAX_POSTINGS. When fetch() was cut short, the run searches for your titles so the jobs
   * past the cap that fit you are still seen.
   */
  search?(ref: CompanyRef, term: string, ctx: Ctx): Promise<Raw[]>;
  /**
   * True when the list's location is only a placeholder ("3 Locations"): the run then asks
   * describe() for the real one before the location gate, for jobs whose title already matches.
   */
  vagueLocation?(raw: Raw): boolean;
  /**
   * Is this one job still up? Asked before an alert (see liveness.ts), for jobs from this system or
   * whose link is on it. One cheap request: true = open, false = taken down, undefined = can't tell.
   */
  isOpen?(job: Pick<Job, "id" | "url">, ctx: Ctx): Promise<boolean | undefined>;
  /** A job board (JOB_BOARDS): its name, used instead of one guessed from the slug. */
  label?: string;
  /**
   * Fetch at most this often; in between, a scan reuses the jobs from the last fetch. For boards that
   * ask for few requests a day.
   */
  minIntervalHours?: number;
}

/** Postings one search() reads at most: it's for the jobs past a cap that fit you, not a second full list. */
export const SEARCH_MAX_POSTINGS = 200;

/** What a job's own page adds to its list entry. */
export type JobDetail = Partial<Pick<NormalizedJob, "description" | "location" | "country" | "workplace" | "postedAt">>;

export function jobId(ats: AtsType, slug: string, atsJobId: string | number): string {
  return `${ats}:${slug.toLowerCase()}:${atsJobId}`;
}

/** The company part of a job id: "ats:slug", "workday:tenant|site", "taleo:host|section". */
export function jobCompanyKey(c: { ats: string; slug: string; site?: string }): string {
  const slug = c.ats === "workday" ? `${c.slug}|${c.site}` : c.ats === "taleo" ? `${c.slug}|${c.site || "2"}` : c.slug;
  return `${c.ats}:${slug}`.toLowerCase();
}

/** A job's company, read off its id; equals jobCompanyKey() of the company it came from. */
export const companyOfJobId = (id: string) => id.split(":", 2).join(":").toLowerCase();

/**
 * A Workday job's id: the requisition number at the end of its path ("Senior-PM_R12345" -> "R12345"),
 * so a title edit doesn't look like a new job. Paths without one keep their last segment.
 */
export function workdayJobKey(externalPath: string): string {
  const seg = externalPath.split("/").pop() || externalPath;
  return seg.match(/_([A-Za-z]*-?\d[\w-]*)$/)?.[1] ?? seg;
}

/** Ids saved before workdayJobKey() existed, rewritten to the current form so their history carries on. */
export function currentJobId(id: string): string {
  if (!id.startsWith("workday:")) return id;
  const at = id.indexOf(":", "workday:".length);
  return at < 0 ? id : id.slice(0, at + 1) + workdayJobKey(id.slice(at + 1));
}

/** First path segment of a URL, decoded; "" if none. */
export function firstPathSegment(url: URL): string {
  const seg = url.pathname.split("/").filter(Boolean)[0] ?? "";
  return decodeURIComponent(seg);
}

/** "1 YEAR", "per-year-salary", "yearly" -> "year". */
export function salaryPeriod(raw: string | null | undefined): string | undefined {
  const m = raw?.toLowerCase().match(/year|month|week|day|hour/);
  return m?.[0];
}
