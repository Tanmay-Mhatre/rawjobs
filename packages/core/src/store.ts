import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BoardHealth } from "./board-health";
import { companyIndustries } from "./catalog/industries";
import { cleanVisa } from "./catalog/visa";
import { companyKey, companyOfJobId, jobCompanyKey } from "./connectors";
import { toDashboardJob } from "./dashboard";
import type { MergeResult } from "./diff";
import type { RunResult } from "./run";
import type { Config, DashboardJob, DashboardJobsFile, DataMeta, Job, JobsFile, RunSummary } from "./schema";
import { readJsonOrSetAside, writeFileAtomic } from "./atomic";
import { readJsonOnce } from "./json-once";

/** Write the file unless it already says exactly this (same size first, so a changed file is rarely read). */
export function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && statSync(path).size === Buffer.byteLength(text) && readFileSync(path, "utf8") === text) return false;
  writeFileAtomic(path, text);
  return true;
}

/** How many run summaries meta.json keeps (the dashboard's health history). */
export const KEEP_RUNS = 30;

/** Run files: a damaged one is set aside (and said so) instead of failing every scan after it. */
function readJson<T>(path: string): T | undefined {
  return readJsonOrSetAside<T>(path, (bad) => console.warn(`${path} couldn't be read; moved it to ${bad} and started fresh.`));
}

/** Every job seen so far, with descriptions (history.json; before it existed, jobs.json held the same). */
export function readJobs(dir: string): Job[] {
  const history = readJson<JobsFile>(join(dir, "history.json"));
  if (history) return history.jobs;
  const legacy = readJson<JobsFile | DashboardJobsFile>(join(dir, "jobs.json"));
  return legacy?.version === 1 ? legacy.jobs : [];
}

export function readMeta(dir: string): DataMeta | undefined {
  return readJson<DataMeta>(join(dir, "meta.json"));
}

/** Your companies whose board is failing, by companyKey(), and since when. */
function yourFailingBoards(config: Config, boards: BoardHealth): NonNullable<DataMeta["boardHealth"]> {
  const out: NonNullable<DataMeta["boardHealth"]> = {};
  for (const c of config.companies) {
    const r = boards.boards[jobCompanyKey(c)];
    if (r?.fails && r.since !== undefined) out[companyKey(c)] = { since: new Date(r.since).toISOString() };
  }
  return out;
}

export function summarize(run: RunResult, merged: MergeResult): RunSummary {
  const current = run.jobs;
  return {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    partial: run.partial,
    jobsFound: current.length,
    matches: current.filter((j) => !j.why.gate).length,
    newMatches: current.filter((j) => !j.why.gate && merged.newIds.has(j.id)).length,
    closed: merged.closedIds.size,
    checked: run.checked,
    health: run.health,
    ...(run.moves?.length ? { moves: run.moves } : {}),
  };
}

type DirectoryRow = { key: string; ats: string; slug: string; site?: string; tags?: string[]; title_tags?: string[]; visa?: unknown };

/** The published directory's companies (data/catalog/directory.json), if built. */
const directoryCompanies = (dir: string): DirectoryRow[] => {
  try {
    return readJsonOnce<{ companies: DirectoryRow[] }>(join(dir, "catalog", "directory.json"))?.companies ?? [];
  } catch {
    return [];
  }
};

/** Industry ids per company directory key. */
function directoryIndustries(companies: readonly DirectoryRow[]): Map<string, string[]> {
  return new Map(companies.map((c) => [c.key, companyIndustries(c)] as const).filter(([, ids]) => ids.length));
}

/**
 * Write the run's files:
 *   history.json       every job, with descriptions for those that pass the gates (merge reads this)
 *   jobs.json          dashboard: jobs that pass your gates, no descriptions
 *   jobs-other.json    dashboard: the rest, loaded only on demand
 *   descriptions.json  dashboard: id -> description, loaded when a job is opened
 *   meta.json, runs/<time>.json
 */
export function saveRun(
  dir: string,
  config: Config,
  run: RunResult,
  merged: MergeResult,
  opts: {
    /** Add this run to the run history (not for a one-company "Check now"). */ record?: boolean;
    /** Board health after this run: your failing companies' streaks go into meta.json. Kept as it was when absent. */
    boards?: BoardHealth;
  } = {},
): RunSummary {
  mkdirSync(join(dir, "runs"), { recursive: true });
  const summary = summarize(run, merged);
  const generatedAt = run.finishedAt;

  const jobs = merged.jobs.map((j) => (j.why.gate ? { ...j, description: undefined } : j));
  const history: JobsFile = { version: 1, generatedAt, jobs };
  writeFileAtomic(join(dir, "history.json"), JSON.stringify(history));

  const directory = directoryCompanies(dir);
  const industries = directoryIndustries(directory);
  const visas = new Map(
    directory.flatMap((c) => {
      const v = cleanVisa(c.visa);
      return v ? [[c.key, v] as const] : [];
    }),
  );
  // Job ids carry jobCompanyKey(), which differs from the directory key for Workday and Taleo:
  // map one to the other so the Radar can match jobs to your companies and their industries.
  const keyOfJob = new Map([...directory.map((c) => [jobCompanyKey(c), c.key] as const), ...config.companies.map((c) => [jobCompanyKey(c), companyKey(c)] as const)]);
  const dashboard = jobs.map((j) => {
    const key = keyOfJob.get(companyOfJobId(j.id)) ?? companyOfJobId(j.id);
    const tags = industries.get(key);
    const visa = visas.get(key);
    return { ...toDashboardJob(j), companyKey: key, ...(tags ? { industries: tags } : {}), ...(visa ? { visa } : {}) };
  });
  const file = (list: DashboardJob[]): DashboardJobsFile => ({ version: 2, generatedAt, jobs: list });
  writeFileAtomic(join(dir, "jobs.json"), JSON.stringify(file(dashboard.filter((j) => !j.why.gate))));
  writeFileAtomic(join(dir, "jobs-other.json"), JSON.stringify(file(dashboard.filter((j) => j.why.gate))));
  // The biggest file, and often unchanged: written only when a description changed.
  writeIfChanged(join(dir, "descriptions.json"), JSON.stringify(Object.fromEntries(jobs.filter((j) => j.description).map((j) => [j.id, j.description]))));

  const prev = readMeta(dir);
  const prevRuns = prev?.runs ?? [];
  const boardHealth = opts.boards ? yourFailingBoards(config, opts.boards) : prev?.boardHealth;
  const meta: DataMeta = {
    version: 1,
    generatedAt,
    profile: config.profile,
    companies: config.companies.map(({ name, ats, slug, shard, site, enabled, careers_url }) => {
      const tags = industries.get(companyKey({ ats, slug, shard, site }));
      return { name, ats, slug, enabled, careers_url, ...(tags ? { industries: tags } : {}) };
    }),
    runs: opts.record === false ? prevRuns : [summary, ...prevRuns].slice(0, KEEP_RUNS),
    ...(boardHealth && Object.keys(boardHealth).length ? { boardHealth } : {}),
  };
  writeFileAtomic(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  if (opts.record === false) return summary;
  const stamp = run.startedAt.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  writeFileAtomic(join(dir, "runs", `${stamp}.json`), JSON.stringify(summary, null, 2));
  return summary;
}
