import { resolve } from "node:path";

/**
 * Your RawJobs folder: rawjobs.config.local.yaml, profile/ (resume, secrets, tracking) and, unless
 * RAWJOBS_DATA says otherwise, data/. It's RAWJOBS_HOME when set (an installed copy keeps it in your
 * user folder), else the folder RawJobs runs in (a repo checkout, as before).
 */
export function rawjobsHome(): string {
  return resolve(process.env.RAWJOBS_HOME || process.cwd());
}

/** The run output folder: RAWJOBS_DATA (relative to your RawJobs folder), else data/ in it. */
export function defaultDataDir(home = rawjobsHome()): string {
  return resolve(home, process.env.RAWJOBS_DATA || process.env.JOBHUNTER_DATA || "data");
}
