import { companyOfJobId, getConnector, jobCompanyKey } from "./connectors";
import { BoardClosedError } from "./connectors/parse";
import { HostSkippedError, HttpClient, HttpError } from "./http";
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
};

/** Description fetches per company per run, for ATSs that need one request per job. */
const MAX_DESCRIBE_PER_COMPANY = 40;

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
  /** Companies you haven't added, checked live too; only their jobs that pass your gates are kept. */
  checks?: readonly CompanyRef[];
  onCompanyDone?: (h: CompanyHealth) => void;
  /** Each company's health and the jobs kept from it, as soon as it's done (to save progress). */
  onCompanyResult?: (h: CompanyHealth, jobs: Job[]) => void;
  /** jobCompanyKey()s of companies already fetched (a resumed scan): skipped. */
  skip?: ReadonlySet<string>;
  /** Stop starting new companies once this returns true (companies in flight finish). */
  stopped?: () => boolean;
  /** A company's industry ids, when the directory knows them (for the industry part of the score). */
  industriesOf?: (c: CompanyRef) => readonly string[] | undefined;
};

/**
 * One lane per hiring system, all lanes at once, and a few companies at a time within a lane. Every
 * site still gets its own pace (HttpClient's per-host spacing): companies sharing one API host just
 * queue for it, while companies on their own hosts (Workday tenants, Recruitee, BambooHR…) run side by side.
 */
const laneOf = (c: CompanyRef) => `${c.ats}:${c.region ?? ""}:${c.ats === "workday" ? c.shard : ""}`;
/** Companies in flight per lane. */
const LANE_WORKERS = 4;

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

  /** A company's open jobs from the last fetch, if that was less than `hours` ago. */
  const recentJobs = (key: string, hours: number): Job[] | undefined => {
    const last = [...previous.values()].filter((j) => j.status === "open" && companyOfJobId(j.id) === key);
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
      const recent = connector.minIntervalHours ? recentJobs(jobCompanyKey(company), connector.minIntervalHours) : undefined;
      for (const j of recent ?? []) {
        const { score, why } = scoreJob(j, config.profile, fit);
        if (!extra || !why.gate) kept.push({ ...j, score, why });
        if (!why.gate) h.matches++;
      }
      const raws = recent
        ? []
        : await connector.fetch(company, {
            http,
            now,
            partial: () => {
              h.partial = true;
            },
          });
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
      let described = 0;
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
        const prev = previous.get(base.id);
        const firstSeen = prev?.firstSeen ?? nowIso;
        let { score, why } = scoreJob(base, config.profile, fit);
        // Lists without descriptions (or with only "3 Locations"): reuse what's stored, else fetch the
        // job's page for jobs that pass the gates (or pass the title gate, when the location is vague).
        const vague = !!connector.vagueLocation?.(raw);
        if (connector.describe && (vague ? !why.gate || why.gate === "location" : !why.gate && !base.description)) {
          if (prev?.description) Object.assign(base, { description: prev.description }, vague ? { location: prev.location, country: prev.country, workplace: prev.workplace } : {});
          else if (described < MAX_DESCRIBE_PER_COMPANY) {
            described++;
            const d = await connector.describe(raw, company, { http, now }).catch(() => {
              h.describeFailed = (h.describeFailed ?? 0) + 1;
              return "";
            });
            if (typeof d === "string") base.description = d;
            else for (const [k, v] of Object.entries(d)) if (v) Object.assign(base, { [k]: v });
          }
          ({ score, why } = scoreJob(base, config.profile, fit));
        }
        // Your companies keep every job (the Radar can show the rest); extra checks only matches.
        if (!extra || !why.gate) {
          const postedAt = earliestPosted(base.postedAt, prev);
          // The board's own date, kept when it's later: a board that refreshes it (see staleReasons in the dashboard).
          const boardPostedAt = base.postedAt && postedAt && Date.parse(base.postedAt) > Date.parse(postedAt) ? base.postedAt : undefined;
          // A repost's history (set in mergeHistory) carries over while the job stays listed.
          const reposts = prev?.repostedAt ? { repostedAt: prev.repostedAt, ...(prev.repostCount ? { repostCount: prev.repostCount } : {}) } : {};
          kept.push({ ...base, ...reposts, postedAt, ...(boardPostedAt ? { boardPostedAt } : {}), firstSeen, lastSeen: nowIso, status: "open", score, why });
        }
        if (!why.gate) h.matches++;
      }
      h.jobsFound = recent?.length ?? raws.length - (h.skipped ?? 0);
      h.ok = true;
    } catch (err) {
      h.error = err instanceof HttpError && err.status === 404 ? `board not found (404): check the slug "${company.slug}" against the careers URL` : (err as Error).message;
      if (!h.unsupported) h.failure = failureOf(err);
    }
    h.durationMs = Date.now() - started;
    jobs.push(...kept);
    health.push(h);
    opts.onCompanyDone?.(h);
    opts.onCompanyResult?.(h, kept);
  };

  // One lane per hiring system (yours first within each), all lanes at once, LANE_WORKERS per lane.
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
          await fetchOne(company, extra);
        }
      };
      return Array.from({ length: Math.min(LANE_WORKERS, lane.length) }, worker);
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
