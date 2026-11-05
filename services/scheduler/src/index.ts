/**
 * Starts the scheduled GitHub workflows on time. GitHub's own crons start runs 3–10 hours late and
 * drop some slots altogether, so this Worker wakes every 5 minutes and dispatches each workflow in
 * SCHEDULE whose time fell in the last 5 minutes (the window ending at this tick).
 *
 * Each entry fires 10 minutes before the workflow's own GitHub cron, which stays in the workflow as
 * the backup. Its runs are named "<workflow> · scheduler" (the `source` input), and the workflow's
 * slot guard (scripts/catalog/slot-covered.mjs) makes the later GitHub cron run for the same slot
 * do nothing. test/scheduler.test.ts checks every entry against the workflow files.
 *
 * Replaces services/feed-trigger. Setup: see wrangler.toml. Needs one secret, GITHUB_TOKEN: a
 * fine-grained token for the app repo with "Actions: read and write" and nothing else.
 */

type Env = {
  GITHUB_TOKEN: string;
  /** owner/name of the repo with the workflows. */
  REPO: string;
  REF: string;
};

export type Entry = {
  /** File name in .github/workflows. */
  workflow: string;
  /** 5-field cron expression, UTC. */
  cron: string;
  /** Extra workflow_dispatch inputs. Only inputs the workflow declares: GitHub rejects others (HTTP 422). */
  inputs?: Record<string, string>;
};

/** Every entry is its workflow's GitHub cron minus 10 minutes (the slot guard's lead). */
export const SCHEDULE: Entry[] = [
  { workflow: "jobs-daily.yml", cron: "13 */6 * * *" }, // GitHub: 23 */6 * * *
  { workflow: "directory-contributions.yml", cron: "7 */3 * * *" }, // GitHub: 17 */3 * * *
  { workflow: "data-health.yml", cron: "27 11,23 * * *" }, // GitHub: 37 11 and 37 23
  { workflow: "connector-health.yml", cron: "43 6 * * *" }, // GitHub: 53 6 * * *
  { workflow: "directory-commoncrawl.yml", cron: "30 13 * * *" }, // GitHub: 40 13 * * *
  { workflow: "concepts-weekly.yml", cron: "31 3 * * 0" }, // GitHub: 41 3 * * 0
];

/** The Worker's own cron (wrangler.toml) ticks every this many minutes. */
export const TICK_MINUTES = 5;

/** Does one cron field match value v? Supports "*", "7", "0,30", "1-5", "*\/3", "10-50/10". `min` is the field's lowest value, where "*" steps start. */
function fieldMatches(field: string, v: number, min = 0): boolean {
  return field.split(",").some((part) => {
    const [range = "", stepStr] = part.split("/");
    const step = stepStr === undefined ? 1 : Number(stepStr);
    let lo: number;
    let hi: number;
    if (range === "*") [lo, hi] = [min, Number.POSITIVE_INFINITY];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number) as [number, number];
    else [lo, hi] = stepStr === undefined ? [Number(range), Number(range)] : [Number(range), Number.POSITIVE_INFINITY];
    if (!Number.isInteger(step) || step < 1 || Number.isNaN(lo) || Number.isNaN(hi)) throw new Error(`Bad cron field: ${field}`);
    return v >= lo && v <= hi && (v - lo) % step === 0;
  });
}

/** Does a 5-field cron (UTC, as GitHub runs it) fire at this whole minute? */
export function cronMatches(cron: string, ms: number): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Bad cron: ${cron}`);
  const [mi, ho, dom, mon, dow] = fields as [string, string, string, string, string];
  const d = new Date(ms);
  const domOk = fieldMatches(dom, d.getUTCDate(), 1);
  const dowOk = fieldMatches(dow, d.getUTCDay()) || (d.getUTCDay() === 0 && fieldMatches(dow, 7));
  // As in standard cron: with both day fields restricted, either one matching is enough.
  const dayOk = dom === "*" || dow === "*" ? domOk && dowOk : domOk || dowOk;
  return dayOk && fieldMatches(mon, d.getUTCMonth() + 1, 1) && fieldMatches(ho, d.getUTCHours()) && fieldMatches(mi, d.getUTCMinutes());
}

/** Entries whose cron fired in the window (tick - 5 min, tick], so each fires on exactly one tick. */
export function dueEntries(schedule: Entry[], tickMs: number): Entry[] {
  const top = Math.floor(tickMs / 60000) * 60000;
  const minutes = Array.from({ length: TICK_MINUTES }, (_, i) => top - i * 60000);
  return schedule.filter((e) => minutes.some((t) => cronMatches(e.cron, t)));
}

/** Ask GitHub to start one workflow on REF. Throws on anything but 204. */
export async function dispatch(env: Env, entry: Entry, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = `https://api.github.com/repos/${env.REPO}/actions/workflows/${entry.workflow}/dispatches`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "user-agent": "rawjobs-scheduler",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: env.REF, inputs: { ...entry.inputs, source: "scheduler" } }),
  });
  if (res.status !== 204) throw new Error(`${entry.workflow}: workflow_dispatch failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/** Dispatch everything due at this tick. One failure doesn't stop the others; any failure throws at the end, so it shows in the Worker's logs. */
export async function tick(env: Env, tickMs: number, fetchImpl: typeof fetch = fetch, schedule: Entry[] = SCHEDULE): Promise<string[]> {
  const due = dueEntries(schedule, tickMs);
  const results = await Promise.allSettled(due.map((e) => dispatch(env, e, fetchImpl)));
  const failed = results.flatMap((r) => (r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []));
  for (const message of failed) console.error(message);
  if (failed.length) throw new Error(`${failed.length} of ${due.length} dispatches failed: ${failed.join("; ")}`);
  return due.map((e) => e.workflow);
}

export default {
  async scheduled(event: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(tick(env, event.scheduledTime));
  },
};
