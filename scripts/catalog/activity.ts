/**
 * Hiring activity (packages/core/src/activity.ts): record this run's new roles per company from the job
 * feed's change file, and publish jobs-activity-<seq>.json.br next to the feed, listed in
 * jobs-v3-manifest.json and jobs-v2-manifest.json. Runs after jobs.ts merge and before the manifests
 * are signed:
 *
 *   pnpm exec tsx scripts/catalog/activity.ts [--out out/jobs]
 *
 * Reads, in <out>: the feed's third format (every hiring system; else the second): manifest, full copy
 * and change file; and activity-state.json (the days recorded so far, carried by state.sh). Writes the
 * state, the file, and last the manifests' `activity` entries. Anything going wrong leaves the
 * manifests as they were, so the feed publishes without activity that run (lib/activity.ts).
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeActivity } from "./lib/activity";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = resolve(arg("--out") ?? join(here, "out", "jobs"));

const { file, bytes, stateBytes, notes } = writeActivity(OUT);
for (const n of notes) console.error(`Activity: ${n}.`);
const companies = Object.values(file.companies);
const counted = companies.filter((c) => c.n > 0).length;
const mb = (n: number) => (n / 1e6).toFixed(2);
console.error(`Activity: ${mb(bytes)} MB, ${companies.length} companies (${counted} with new roles in the last 30 days), records since ${file.since ?? "tomorrow"}; state ${mb(stateBytes)} MB.`);
