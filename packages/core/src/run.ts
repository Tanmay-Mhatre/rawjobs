import { companyOfJobId, getConnector, jobCompanyKey } from "./connectors";
import { hashIds } from "./board-health";
import { BoardClosedError } from "./connectors/parse";
import type { BoardIds } from "./connectors/types";
import { HostSkippedError, HttpClient, HttpError } from "./http";
import { limiter } from "./limit";
import type { BoardMove, CompanyHealth, CompanyRef, Config, Job, NormalizedJob, Profile } from "./schema";
import { scoreJob } from "./score";
import { safeUrl } from "./text";

export type RunResult = {
  startedAt: string;
  finishedAt: string;
  /** Jobs listed in this run only (history is merged separately, see diff.ts). */
  jobs: Job[];
  health: CompanyHealth[];
  partial: boolean;
  /** Companies beyond yours checked live this run (see discover.ts). */
  checked: number;
  /** Suggested new boards for your companies whose board is gone (see findMoves). */
  moves?: BoardMove[];
  /** Every company in the directory was checked (a background check or a full scan that finished). */
  everyCompany?: boolean;
};

/**
 * Description fetches per company per run, for ATSs that need one request per job: up to 40 for your
 * companies, 5 for directory ones (the rest are fetched on later scans: what's fetched is remembered).
 */
const MAX_DESCRIBE_PER_COMPANY = 40;
const MAX_DESCRIBE_PER_CHECK = 5;
/** Description fetches in flight per company (each host still keeps its own pace). */
const DESCRIBE_WORKERS = 4;

/**
 * The background check after Scan now goes easy on the computer: at most this many companies in
 * flight across every lane, each with fewer description fetches at once. Scan now has no such cap.
 */
export const BACKGROUND_LIMITS = { maxCompaniesInFlight: 24, describeWorkers: 2 } as const;

/** Where a job with a vague location ("3 Locations") really is, from its detail page (see LocationCache). */
export type ResolvedLocation = Pick<NormalizedJob, "location"> & Partial<Pick<NormalizedJob, "country" | "workplace">>;
/** Resolved locations by job id, kept between scans, so a job's detail page is fetched for its place only once. */
export type LocationCache = Map<string, ResolvedLocation>;

/** Title searches per capped company: each is a few more requests to the same board. */
const MAX_SEARCH_TERMS = 5;

/** Level words that narrow a search without changing the role: "Senior Product Manager" searches as "product manager". */
const LEVEL = /^(?:(?:senior|sr\.?|junior|jr\.?|lead|principal|staff|associate|group|mid[- ]level|entry[- ]level)\s+)+/i;
/** One-word titles that would match most of a big employer's list, so a search for them finds nothing new. */
const GENERIC = new Set([
  "manager",
  "director",
  "head",
  "lead",
  "engineer",
  "developer",
  "analyst",
  "specialist",
  "consultant",
  "associate",
  "officer",
  "executive",
  "coordinator",
  "assistant",
  "administrator",
  "intern",
  "senior",
  "staff",
]);

/**
 * What to search a capped board for: your titles without level words, most specific first, at most
 * MAX_SEARCH_TERMS. A title that contains another one is left out ("product manager" already finds
 * "technical product manager"), as are lone generic words and short forms ("PM"), which search poorly.
 */
export function searchTerms(profile: Pick<Profile, "titles">): string[] {
  const cleaned = profile.titles.include.map((t) => t.toLowerCase().replace(/\s+/g, " ").trim().replace(LEVEL, "").trim());
  const usable = [...new Set(cleaned)].filter((t) => (t.includes(" ") ? true : t.length >= 4 && !GENERIC.has(t)));
  const words = (t: string) => ` ${t} `;
  const broadest = usable.filter((t) => !usable.some((o) => o !== t && words(t).includes(words(o))));
  // Multi-word titles first: they're the specific ones a big board's search answers best.
  return [...broadest.filter((t) => t.includes(" ")), ...broadest.filter((t) => !t.includes(" "))].slice(0, MAX_SEARCH_TERMS);
}

/**
 * A posting's date only ever moves earlier. Boards that give relative dates ("Posted 30+ Days Ago")
 * would otherwise be worked out afresh every scan and never age; boards that send an "updated" date
 * would look new after every edit. Nor can a job be posted after we first saw it.
 */
export function earliestPosted(posted: string | undefined, prev: Pick<Job, "postedAt" | "firstSeen"> | undefined): string | undefined {
  const dates = [posted, prev?.postedAt, prev && posted ? prev.firstSeen : undefined].filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)));
  return dates.length ? dates.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : undefined;
}

export type RunOptions = {
  http?: HttpClient;
  now?: Date;
  /** Only run companies whose name or slug matches (case-insensitive). */
  only?: string[];
  /** Jobs from earlier runs; keeps firstSeen stable so freshness and "new" are right. */
  previous?: readonly Job[];
  /**
   * Companies you haven't added, checked live too; only their jobs that pass your gates are kept,
   * plus the ones already in history (a job that stops matching is still listed, not closed).
   */
  checks?: readonly CompanyRef[];
  onCompanyDone?: (h: CompanyHealth) => void;
  /** Each company's health and the jobs kept from it, as soon as it's done (to save progress). */
  onCompanyResult?: (h: CompanyHealth, jobs: Job[]) => void;
  /** jobCompanyKey()s of companies already fetched (a resumed scan): skipped. */
  skip?: ReadonlySet<string>;
  /**
   * Stop starting new companies once this returns true. Companies in flight are left unrecorded (a
   * resumed scan fetches them again); pass the same check as the HttpClient's `stopped` to cut them short.
   */
  stopped?: () => boolean;
  /** A company's industry ids, when the directory knows them (for the industry part of the score). */
  industriesOf?: (c: CompanyRef) => readonly string[] | undefined;
  /** Locations resolved by earlier scans (read, and added to as jobs are described). */
  locations?: LocationCache;
  /**
   * Paged boards' first pages from recent full reads (board-health.ts knownFirstPages), by
   * jobCompanyKey(). A board whose first page is the same is read no further: its jobs from then are kept.
   */
  firstPages?: ReadonlyMap<string, string>;
  /** Ids boards' APIs need, learned once and kept between scans (board-ids.ts). */
  ids?: BoardIds;
  /** Companies in flight across every lane at once (BACKGROUND_LIMITS); no cap without it. */
  maxCompaniesInFlight?: number;
  /** Description fetches in flight per company (default DESCRIBE_WORKERS). */
  describeWorkers?: number;
};

/**
 * One lane per hiring system, all lanes at once, and a few companies at a time within a lane. Every
 * site still gets its own pace (HttpClient's per-host spacing): companies sharing one API host just
 * queue for it, while companies on their own hosts (Workday tenants, Recruitee, BambooHR…) run side by side.
 */
export const laneOf = (c: Pick<CompanyRef, "ats" | "region" | "shard">) => `${c.ats}:${c.region ?? ""}:${c.ats === "workday" ? c.shard : ""}`;
/** Companies in flight per lane: more where the API's own pace (http.ts paceOf) is the limit, not the lane. */
const LANE_WORKERS = 4;
// Mostly an employer per host, and every host keeps its own 1 s gap: more at once asks no host faster.
const LANE_WORKERS_BY_ATS: Partial<Record<CompanyRef["ats"], number>> = { greenhouse: 8, workday: 8, smartrecruiters: 6, icims: 8, oracle: 8, taleo: 8, successfactors: 8, phenom: 8 };
/** Companies a lane of this hiring system fetches at once (scope.ts learns and estimates speeds with it). */
export const laneWorkers = (ats: string): number => LANE_WORKERS_BY_ATS[ats as CompanyRef["ats"]] ?? LANE_WORKERS;

/**
 * One pass over every enabled company (then any extra `checks`). A failing company never stops the
 * run; it is recorded in health instead. Health comes back in input order.
 */
export async function runRadar(config: Config, opts: RunOptions = {}): Promise<RunResult> {
  const http = opts.http ?? new HttpClient();
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const only = opts.only?.map((s) => s.toLowerCase());
  const companies = config.companies.filter((c) => c.enabled && (!only?.length || only.includes(c.name.toLowerCase()) || only.includes(c.slug.toLowerCase())));
  const previous = new Map((opts.previous ?? []).map((j) => [j.id, j]));
  const checks = opts.checks ?? [];
  const terms = searchTerms(config.profile);

  const jobs: Job[] = [];
  const order = new Map<string, number>();
  const health: CompanyHealth[] = [];
  const todo = [...companies.map((c) => [c, false] as const), ...checks.map((c) => [c, true] as const)].filter(([c]) => !opts.skip?.has(jobCompanyKey(c)));
  for (const [i, [c]] of todo.entries()) order.set(`${c.ats}:${c.slug}`, i);
  // Each company's open jobs from earlier runs, gathered once (a scan of the whole directory has thousands of companies).
  const openBefore = new Map<string, Job[]>();
  for (const j of previous.values()) {
    if (j.status !== "open") continue;
    const key = companyOfJobId(j.id);
    const list = openBefore.get(key);
    if (list) list.push(j);
    else openBefore.set(key, [j]);
  }
  // A first page is only the same for the same profile: a new one could match jobs the last read didn't keep.
  const profileSalt = hashIds([JSON.stringify(config.profile)]);

  /** A company's open jobs from the last fetch, if that was less than `hours` ago. */
  const recentJobs = (key: string, hours: number): Job[] | undefined => {
    const last = openBefore.get(key) ?? [];
    const lastSeen = Math.max(0, ...last.map((j) => Date.parse(j.lastSeen)));
    return last.length && now.getTime() - lastSeen < hours * 3_600_000 ? last : undefined;
  };

  const fetchOne = async (company: CompanyRef, extra: boolean) => {
    const started = Date.now();
    const h: CompanyHealth = { company: company.name, ats: company.ats, slug: company.slug, key: jobCompanyKey(company), ok: false, jobsFound: 0, matches: 0, durationMs: 0 };
    const kept: Job[] = [];
    const connector = getConnector(company.ats);
    // Extra checks are directory companies; the rest are yours, which always count as your industry.
    const fit = { tracked: !extra, industries: opts.industriesOf?.(company) };
    try {
      if (!connector) {
        h.unsupported = true;
        throw new Error(`${company.ats} support is coming soon`);
      }
      // Boards that ask for few requests a day: between fetches, keep the jobs from the last one.
      const recent = connector.minIntervalHours ? recentJobs(h.key!, connector.minIntervalHours) : undefined;
      // A paged board whose first page is as the last full read saw it: that read's jobs are kept. Your
      // companies keep every job, so theirs must all be there; a directory board keeps only matches.
      const known = opts.firstPages?.get(h.key!);
      const before = openBefore.get(h.key!) ?? [];
      let total = 0;
      const raws = recent
        ? []
        : await connector.fetch(company, {
            http,
            now,
            ids: opts.ids,
            partial: () => {
              h.partial = true;
            },
            firstPage: (fingerprint, n) => {
              h.fingerprint = `${profileSalt}/${fingerprint}`;
              total = n;
              h.unchanged = h.fingerprint === known && (extra || before.length === n);
              return h.unchanged;
            },
          });
      if (!h.unchanged) delete h.unchanged;
      const reused = recent ?? (h.unchanged ? before.map((j) => ({ ...j, lastSeen: nowIso })) : undefined);
      if (h.unchanged) raws.length = 0;
      for (const j of reused ?? []) {
        const { score, why } = scoreJob(j, config.profile, fit);
        // These all come from history, so they're all kept (see below).
        kept.push({ ...j, score, why });
        if (!why.gate) h.matches++;
      }
      // A list cut short at its cap: ask the board's own search for your titles, so the jobs past the
      // cap that fit you are still seen. The company stays partial: its other unseen jobs aren't gone.
      if (h.partial && connector.search && terms.length) {
        const idOf = (raw: unknown) => {
          try {
            return connector.normalize(raw, company).id;
          } catch {
            return undefined;
          }
        };
        const seen = new Set(raws.map(idOf));
        let found = 0;
        for (const term of terms) {
          if (opts.stopped?.()) break;
          // A failed search loses only its own extra jobs, never the list already fetched.
          const more = await connector.search(company, term, { http, now }).catch(() => []);
          for (const raw of more) {
            const id = idOf(raw);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            raws.push(raw);
            found++;
          }
        }
        h.searchFound = found;
      }
      // First the whole list, scored; then the detail pages it needs, a few at a time.
      type Item = { raw: unknown; base: NormalizedJob; prev?: Job; vague: boolean; describe: boolean; score: number; why: Job["why"] };
      const items: Item[] = [];
      const maxDescribe = extra ? MAX_DESCRIBE_PER_CHECK : MAX_DESCRIBE_PER_COMPANY;
      let described = 0;
      const ids: string[] = [];
      for (const raw of raws) {
        let base: NormalizedJob;
        try {
          base = connector.normalize(raw, company);
        } catch {
          // One malformed posting (a missing title, say) shouldn't lose the company's other jobs.
          h.skipped = (h.skipped ?? 0) + 1;
          continue;
        }
        base.url = safeUrl(base.url) ?? "";
        ids.push(base.id);
        const prev = previous.get(base.id);
        let { score, why } = scoreJob(base, config.profile, fit);
        // Lists without descriptions (or with only "3 Locations"): reuse what's stored, else fetch the
        // job's page for jobs that pass the gates (or pass the title gate, when the location is vague).
        let vague = !!connector.vagueLocation?.(raw);
        // A place resolved by an earlier scan: no page to fetch just to learn where the job is.
        const known = vague && !prev?.description ? opts.locations?.get(base.id) : undefined;
        if (known) {
          Object.assign(base, known);
          vague = false;
          ({ score, why } = scoreJob(base, config.profile, fit));
        }
        let describe = false;
        if (connector.describe && (vague ? !why.gate || why.gate === "location" : !why.gate && !base.description)) {
          if (prev?.description) {
            Object.assign(base, { description: prev.description }, vague ? { location: prev.location, country: prev.country, workplace: prev.workplace } : {});
            ({ score, why } = scoreJob(base, config.profile, fit));
          } else if (described < maxDescribe) {
            described++;
            describe = true;
          }
        }
        items.push({ raw, base, prev, vague, describe, score, why });
      }
      const queue = items.filter((i) => i.describe);
      const describeWorker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const d = await connector.describe!(item.raw, company, { http, now }).catch(() => {
            h.describeFailed = (h.describeFailed ?? 0) + 1;
            return "";
          });
          const { base } = item;
          if (typeof d === "string") base.description = d;
          else for (const [k, v] of Object.entries(d)) if (v) Object.assign(base, { [k]: v });
          if (item.vague && typeof d !== "string" && d.location)
            opts.locations?.set(base.id, { location: base.location, ...(base.country ? { country: base.country } : {}), workplace: base.workplace });
          ({ score: item.score, why: item.why } = scoreJob(base, config.profile, fit));
        }
      };
      await Promise.all(Array.from({ length: Math.min(opts.describeWorkers ?? DESCRIBE_WORKERS, queue.length) }, describeWorker));
      for (const { base, prev, score, why } of items) {
        const firstSeen = prev?.firstSeen ?? nowIso;
        // Your companies keep every job (the Radar can show the rest); extra checks only matches, and
        // the jobs already in history: one that stops matching is still listed, and leaving it out
        // would read as gone and close it (mergeHistory).
        if (!extra || !why.gate || prev) {
          const postedAt = earliestPosted(base.postedAt, prev);
          // The board's own date, kept when it's later: a board that refreshes it (see staleReasons in the dashboard).
          const boardPostedAt = base.postedAt && postedAt && Date.parse(base.postedAt) > Date.parse(postedAt) ? base.postedAt : undefined;
          // A repost's history (set in mergeHistory) carries over while the job stays listed.
          const reposts = prev?.repostedAt ? { repostedAt: prev.repostedAt, ...(prev.repostCount ? { repostCount: prev.repostCount } : {}) } : {};
          kept.push({ ...base, ...reposts, postedAt, ...(boardPostedAt ? { boardPostedAt } : {}), firstSeen, lastSeen: nowIso, status: "open", score, why });
        }
        if (!why.gate) h.matches++;
      }
      h.jobsFound = h.unchanged ? total : (recent?.length ?? raws.length - (h.skipped ?? 0));
      // Only a list read in full says whether the board's jobs changed (board-health.ts).
      if (!reused && !h.partial) h.idsHash = hashIds(ids);
      h.ok = true;
    } catch (err) {
      h.error = err instanceof HttpError && err.status === 404 ? `board not found (404): check the slug "${company.slug}" against the careers URL` : (err as Error).message;
      if (err instanceof HostSkippedError) h.notReached = true;
      else if (!h.unsupported) h.failure = failureOf(err);
    }
    // Stopped while in flight: the company may have been cut short anywhere (StoppedError, or a
    // connector that caught it and kept what it had), so it's neither done nor failed. Left out of
    // the results and progress, a resumed scan fetches it again.
    if (opts.stopped?.()) return;
    h.durationMs = Date.now() - started;
    jobs.push(...kept);
    health.push(h);
    opts.onCompanyDone?.(h);
    opts.onCompanyResult?.(h, kept);
  };

  // One lane per hiring system (yours first within each), all lanes at once, LANE_WORKERS per lane,
  // and at most maxCompaniesInFlight companies across them all.
  const slot = limiter(opts.maxCompaniesInFlight);
  const lanes = new Map<string, (readonly [CompanyRef, boolean])[]>();
  for (const item of todo) {
    const lane = laneOf(item[0]);
    const list = lanes.get(lane);
    if (list) list.push(item);
    else lanes.set(lane, [item]);
  }
  await Promise.all(
    [...lanes.values()].flatMap((lane) => {
      let next = 0;
      const worker = async () => {
        while (next < lane.length && !opts.stopped?.()) {
          const [company, extra] = lane[next++]!;
          await slot(() => (opts.stopped?.() ? Promise.resolve() : fetchOne(company, extra)));
        }
      };
      return Array.from({ length: Math.min(laneWorkers(lane[0]![0].ats), lane.length) }, worker);
    }),
  );
  health.sort((a, b) => (order.get(`${a.ats}:${a.slug}`) ?? 0) - (order.get(`${b.ats}:${b.slug}`) ?? 0));

  jobs.sort(byScore);
  return {
    startedAt: nowIso,
    finishedAt: new Date().toISOString(),
    jobs,
    health,
    partial: companies.length < config.companies.filter((c) => c.enabled).length || !!opts.stopped?.(),
    checked: checks.length,
  };
}

/**
 * What kind of failure a fetch had, for resting the board (board-health.ts). Only a definite answer
 * is "gone": a timeout, a 5xx or a dropped connection says nothing about the board. Undefined when
 * no request was made (the host was skipped after failing for other boards). "parse" is our side
 * failing to read an answer (a connector bug, left to the daily connector-health check).
 */
export function failureOf(err: unknown): CompanyHealth["failure"] {
  if (err instanceof HostSkippedError) return undefined;
  if (err instanceof BoardClosedError) return "gone";
  if (err instanceof TypeError || err instanceof SyntaxError) return "parse";
  if (!(err instanceof HttpError)) return err instanceof Error && /\bunexpected\b/i.test(err.message) ? "parse" : "other";
  if (err.status === 404 || err.status === 410) return "gone";
  if (err.status !== undefined) return err.status === 429 || err.status >= 500 ? "server" : "other";
  if (/^timed out/.test(err.message)) return "timeout";
  return /^not JSON/.test(err.message) ? "parse" : "network";
}

export function byScore(a: Job, b: Job): number {
  return b.score - a.score || (b.postedAt ?? b.firstSeen).localeCompare(a.postedAt ?? a.firstSeen);
}
