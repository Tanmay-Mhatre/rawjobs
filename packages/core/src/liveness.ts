import { detectCompany, getConnector } from "./connectors";
import { urlOf } from "./connectors/parse";
import { HttpError, type HttpClient } from "./http";
import { JOB_BOARDS, type AtsType, type Job } from "./schema";
import { htmlToText } from "./text";

/**
 * Is a job still open, checked once more just before an alert names it? (After career-ops' "liveness
 * ladder".) Cheapest first: the hiring system's own answer for that one posting, then the job's page.
 * Anything that can't say (a timeout, a 5xx, a 403, a redirect to a careers home page) counts as open:
 * an alert for a job that just closed costs less than a good job that never gets one.
 */

/** Jobs checked per scan at most: a few seconds, however many jobs are new. */
export const MAX_OPEN_CHECKS = 30;
/** Checks in flight at once (HttpClient still spaces requests to one host). */
const CHECK_WORKERS = 4;
/** A page is read this far at most: the closed wording sits near the top. */
const MAX_PAGE_CHARS = 500_000;

/** What hiring systems print on a closed posting. Narrow on purpose: a false "closed" loses a job. */
export const CLOSED_WORDING =
  /\bno longer accepting applications\b|\b(this|the) (job|position|posting|role|vacancy|opening) (is no longer available|has been filled|has expired|is closed|is no longer open)\b/i;

const boards = new Set<string>(JOB_BOARDS);

/**
 * Which of the jobs an alert is about to name are worth checking again, most doubtful first:
 *   1. jobs not read live this run (the earlier part of a resumed scan, or a job board between its
 *      fetches: see minIntervalHours), longest unseen first;
 *   2. jobs from job boards, which can list a job for a while after the employer has closed it.
 * Jobs this run just read off the company's own board are left out: that board listed them minutes
 * ago, so a check would cost a request and almost never find anything. (The shared job feed only
 * chooses which companies a scan fetches live; no job reaches an alert from the feed itself.)
 */
export function jobsToRecheck(jobs: readonly Job[], liveSince: string, max = MAX_OPEN_CHECKS): Job[] {
  const since = Date.parse(liveSince);
  const stale = jobs.filter((j) => Date.parse(j.lastSeen) < since).sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
  const fromBoards = jobs.filter((j) => Date.parse(j.lastSeen) >= since && boards.has(j.ats));
  return [...stale, ...fromBoards].slice(0, max);
}

/**
 * The ladder for one job: the system it came from, then the system its link is on (a job board's
 * job often links to the employer's Greenhouse or Lever), then its page. Never throws.
 */
export async function isStillOpen(job: Pick<Job, "id" | "ats" | "url">, http: HttpClient, now = new Date()): Promise<boolean> {
  const systems = new Set<AtsType>([job.ats]);
  const linked = detectCompany(job.url);
  if (linked?.supported) systems.add(linked.ats);
  for (const ats of systems) {
    const answer = await getConnector(ats)
      ?.isOpen?.(job, { http, now })
      .catch(() => undefined);
    if (answer !== undefined) return answer;
  }
  return (await pageSaysOpen(job.url, http)) ?? true;
}

/**
 * The job's own page: 404 or 410 = closed; a page that says it's closed (CLOSED_WORDING) = closed;
 * any other page that loads where it was asked for = open. Undefined when it can't say.
 */
export async function pageSaysOpen(link: string, http: HttpClient): Promise<boolean | undefined> {
  const url = urlOf(link);
  if (!url || !/^https?:$/.test(url.protocol)) return undefined;
  let res: Response;
  try {
    res = await http.request(url.href, { headers: { accept: "text/html" } });
  } catch (err) {
    return err instanceof HttpError && (err.status === 404 || err.status === 410) ? false : undefined;
  }
  // Sent somewhere else (often the careers home page): that page can't speak for this job.
  if (res.redirected || res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  const text = htmlToText((await res.text().catch(() => "")).slice(0, MAX_PAGE_CHARS));
  return !CLOSED_WORDING.test(text);
}

export type OpenCheckResult = {
  /** Jobs checked (fewer than asked when the scan was stopped). */
  checked: number;
  /** Ids of the jobs found closed. */
  closed: Set<string>;
};

/** Check each job (a few at a time); stops starting new checks once `stopped` says so. */
export async function checkStillOpen(jobs: readonly Job[], opts: { http: HttpClient; now?: Date; stopped?: () => boolean }): Promise<OpenCheckResult> {
  const closed = new Set<string>();
  let checked = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !opts.stopped?.()) {
      const job = jobs[next++]!;
      if (!(await isStillOpen(job, opts.http, opts.now))) closed.add(job.id);
      checked++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_WORKERS, jobs.length) }, worker));
  return { checked, closed };
}
