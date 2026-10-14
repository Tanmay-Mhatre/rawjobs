import { viewSummary, type ActivityView, type HiringSummary } from "@rawjobs/core/activity";
import { citiesIn } from "@rawjobs/core/catalog/places";
import { toDashboardJob } from "@rawjobs/core/dashboard";
import type { DashboardJob, DashboardJobsFile, DataMeta, Job as FullJob, JobsFile } from "@rawjobs/core/schema";

/** data/discover.json (see core discover.ts); declared here so the browser bundle needs no Node code. */
type DiscoverFile = { version: 1; generatedAt: string; indexGeneratedAt: string; jobs: DashboardJob[] };
import { useCallback, useEffect, useState } from "react";

export type { CompanyHealth, DataMeta, Profile, RunSummary } from "@rawjobs/core/schema";
/** A job as the dashboard has it (no description; see useDescription). */
export type Job = DashboardJob;

export type DataState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      /** Your scanned jobs that pass your filters, then the directory's jobs for you (`estimated`). */
      jobs: Job[];
      meta: DataMeta;
      /** When the directory index behind the estimated jobs was built, if there are any. */
      indexGeneratedAt?: string;
    };

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(path, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  // Vite's dev server answers unknown paths with index.html; treat that as "not there yet".
  if (type.includes("text/html")) return null;
  return (await res.json()) as T;
}

/** Files written before the dashboard split held every job, with descriptions, in jobs.json. */
let legacy: { other: Job[]; descriptions: Record<string, string> } | null = null;

/** Fields added to the dashboard files later: filled in here for files written before them. */
const upgrade = (j: Job): Job => (j.cities ? j : { ...j, cities: citiesIn(j.location) });

function fromFile(file: DashboardJobsFile | JobsFile): Job[] {
  if (file.version === 2) return file.jobs.map(upgrade);
  const all = (file.jobs as FullJob[]).map((j) => ({ job: toDashboardJob(j), description: j.description }));
  legacy = {
    other: all.filter((x) => x.job.why.gate).map((x) => x.job),
    descriptions: Object.fromEntries(all.filter((x) => x.description).map((x) => [x.job.id, x.description!])),
  };
  return all.filter((x) => !x.job.why.gate).map((x) => x.job);
}

/** Loads jobs.json (jobs that pass your filters) and meta.json, written by `rawjobs run`. */
export function useData() {
  const [state, setState] = useState<DataState>({ kind: "loading" });

  /** Reads the files again; answers with the meta.json now shown (null: no data, or it couldn't be read). */
  const reload = useCallback(async (): Promise<DataMeta | null> => {
    try {
      const [jobsFile, meta, discover] = await Promise.all([
        getJson<DashboardJobsFile | JobsFile>("./jobs.json"),
        getJson<DataMeta>("./meta.json"),
        // Written by scans since the jobs-first Radar; older data has none.
        getJson<DiscoverFile>("./discover.json").catch(() => null),
      ]);
      otherJobs = undefined;
      descriptions = undefined;
      dataGeneration++;
      legacy = null;
      if (!jobsFile || !meta) {
        setState({ kind: "empty" });
        return null;
      }
      const live = fromFile(jobsFile);
      const ids = new Set(live.map((j) => j.id));
      const estimated = (discover?.jobs ?? []).filter((j) => !ids.has(j.id)).map(upgrade);
      setState({ kind: "ready", jobs: [...live, ...estimated], meta, indexGeneratedAt: discover?.indexGeneratedAt });
      return meta;
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
      return null;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}

let otherJobs: Promise<Job[]> | undefined;
/** Bumped each time the data is reloaded (after a scan), so loaded extras know they're out of date. */
let dataGeneration = 0;
/** Jobs that failed your filters (jobs-other.json), fetched the first time they're needed. */
export function loadOtherJobs(): Promise<Job[]> {
  otherJobs ??= legacy
    ? Promise.resolve(legacy.other)
    : getJson<DashboardJobsFile>("./jobs-other.json")
        .then((f) => (f?.jobs ?? []).map(upgrade))
        .catch(() => []);
  return otherJobs;
}

/**
 * The other jobs once `enabled` turns true (and from then on). After a rescan they're fetched again;
 * until they arrive, the previous scan's stay shown.
 */
export function useOtherJobs(enabled: boolean): Job[] | null {
  const [loaded, setLoaded] = useState<{ generation: number; jobs: Job[] } | null>(null);
  const generation = dataGeneration;
  const current = loaded?.generation === generation;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new data generation (after a rescan) fetches the jobs again
  useEffect(() => {
    if (!enabled || current) return;
    let live = true;
    void loadOtherJobs().then((jobs) => live && setLoaded({ generation, jobs }));
    return () => {
      live = false;
    };
  }, [enabled, current, generation]);
  return loaded?.jobs ?? null;
}

let descriptions: Promise<Record<string, string>> | undefined;
function loadDescriptions(): Promise<Record<string, string>> {
  descriptions ??= legacy
    ? Promise.resolve(legacy.descriptions)
    : getJson<Record<string, string>>("./descriptions.json")
        .then((d) => d ?? {})
        .catch(() => ({}));
  return descriptions;
}

/** A job's description (descriptions.json is fetched once, the first time a job is opened). undefined while loading. */
export function useDescription(job: Job | undefined): string | null | undefined {
  const [text, setText] = useState<{ id: string; value: string | null } | null>(null);
  useEffect(() => {
    if (!job) return;
    if (!job.hasDescription) return setText({ id: job.id, value: null });
    let live = true;
    void loadDescriptions().then((d) => live && setText({ id: job.id, value: d[job.id] ?? null }));
    return () => {
      live = false;
    };
  }, [job]);
  return text && job && text.id === job.id ? text.value : undefined;
}

let activity: Promise<ActivityView | null> | undefined;
let activityGeneration = -1;
/** data/activity.json, fetched the first time a job is opened (and again after a rescan). Null for data without it. */
function loadActivity(): Promise<ActivityView | null> {
  if (activityGeneration !== dataGeneration) {
    activityGeneration = dataGeneration;
    activity = getJson<ActivityView>("./activity.json").catch(() => null);
  }
  return activity!;
}

/**
 * Hiring at the job's company ("Hiring at …" in the drawer): undefined while loading, null when there's
 * nothing for it (no records, data written before activity.json, a job board's copy).
 */
export function useHiring(job: Job | undefined): HiringSummary | null | undefined {
  const [summary, setSummary] = useState<{ id: string; value: HiringSummary | null } | null>(null);
  useEffect(() => {
    if (!job) return;
    let live = true;
    void loadActivity().then((view) => live && setSummary({ id: job.id, value: viewSummary(view, job.companyKey) ?? null }));
    return () => {
      live = false;
    };
  }, [job]);
  return summary && job && summary.id === job.id ? summary.value : undefined;
}

/**
 * This dashboard is served by RawJobs on this computer (`pnpm dev`, `pnpm start`), so it can set up
 * and run scans. A copy built to host somewhere else is built with VITE_RAWJOBS_HOSTED=1.
 */
export const canRunLocally = import.meta.env.DEV || import.meta.env.VITE_RAWJOBS_HOSTED !== "1";

/**
 * Live companies to scan per industry id, as the directory build counted them. Null on the hosted
 * build, before the directory is downloaded, or for a directory built before it counted.
 */
export function useIndustryCounts(): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    fetch("/api/directory", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ industries?: Record<string, number> | null }>) : null))
      .then((s) => live && s?.industries && setCounts(s.industries))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return counts;
}

/**
 * How many companies the shared directory lists (its manifest count), from the local API. The one directory
 * size shown anywhere in the app (Companies, Settings), always via roughCount. `rev` refetches after an update.
 */
export function useDirectorySize(rev = 0): number | null {
  const [n, setN] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` is the trigger: bumped after the directory updates
  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    fetch("/api/directory", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ local?: { companies: number } }>) : null))
      .then((s) => live && s?.local?.companies && setN(s.local.companies))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rev]);
  return n;
}
