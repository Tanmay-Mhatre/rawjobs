#!/usr/bin/env node
// Is this run's schedule slot already covered? GitHub's cron starts runs late (hours) or not at
// all, so a slot can get two triggers: the scheduler Worker, which dispatches 10 minutes before
// the cron time, and GitHub's own cron. Whichever comes second should do nothing.
//
//   node scripts/catalog/slot-covered.mjs <workflow file> runs
//       covered when another run of this workflow on main started in this slot and is still
//       queued or running, or finished successfully
//   node scripts/catalog/slot-covered.mjs <workflow file> since <ISO time>
//       covered when the given time (say the feed's generated_at) is in this slot
//
// This run's slot is the latest cron time at or before the run's creation + 10 minutes, started
// 10 minutes early (the Worker's lead), so a dispatch at :13 and a late cron run for :23 share it.
// Prints why, then a last line covered=true|false. Plain Node, nothing to install.
// Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY and GITHUB_RUN_ID.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LEAD_MS = 10 * 60000;
const SEARCH_MS = 8 * 86400000; // far enough back for a weekly cron

// One cron field ("*", "*/3", "7", "1-5", "0,30", "10-50/10") → does it match value v?
function fieldMatches(field, v) {
  return field.split(",").some((part) => {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let lo;
    let hi;
    if (range === "*") [lo, hi] = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number);
    else [lo, hi] = stepStr ? [Number(range), Number.POSITIVE_INFINITY] : [Number(range), Number(range)];
    if (v < lo || v > hi) return false;
    return (v - (Number.isFinite(lo) ? lo : 0)) % step === 0;
  });
}

/** Does a 5-field cron (UTC, as GitHub runs it) fire at this whole minute? */
export function cronMatches(cron, ms) {
  const [mi, ho, dom, mon, dow] = cron.trim().split(/\s+/);
  const d = new Date(ms);
  const m1 = fieldMatches(dom, d.getUTCDate());
  const m2 = fieldMatches(dow, d.getUTCDay()) || (d.getUTCDay() === 0 && fieldMatches(dow, 7));
  const dayOk = dom === "*" || dow === "*" ? m1 && m2 : m1 || m2;
  return dayOk && fieldMatches(mon, d.getUTCMonth() + 1) && fieldMatches(ho, d.getUTCHours()) && fieldMatches(mi, d.getUTCMinutes());
}

/** The cron expressions in a workflow file. */
export function cronsOf(yaml) {
  return [...yaml.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1]);
}

/** Start of the slot a run created at `createdMs` belongs to, or null if no cron fired in 8 days. */
export function slotStart(crons, createdMs) {
  const top = Math.floor((createdMs + LEAD_MS) / 60000) * 60000;
  for (let t = top; t > top - SEARCH_MS; t -= 60000) if (crons.some((c) => cronMatches(c, t))) return t - LEAD_MS;
  return null;
}

/** Covered by another run? Runs: [{databaseId, createdAt, status, conclusion}]. */
export function coveredByRuns(runs, selfId, start) {
  return runs.find((r) => String(r.databaseId) !== String(selfId) && Date.parse(r.createdAt) >= start && (r.status !== "completed" || r.conclusion === "success"));
}

function main() {
  const [file, mode, since] = process.argv.slice(2);
  if (!file || !["runs", "since"].includes(mode) || (mode === "since" && !since)) {
    console.error("Usage: slot-covered.mjs <workflow file> runs | since <ISO time>");
    process.exit(2);
  }
  const repo = process.env.GITHUB_REPOSITORY;
  const self = process.env.GITHUB_RUN_ID;
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
  const output = (covered) => console.log(`covered=${covered}`);

  const crons = cronsOf(readFileSync(file, "utf8"));
  const created = Date.parse(gh("api", `repos/${repo}/actions/runs/${self}`, "-q", ".created_at").trim());
  const start = crons.length ? slotStart(crons, created) : null;
  if (start === null) {
    console.log("No schedule slot for this run; not covered.");
    return output(false);
  }
  const slot = new Date(start).toISOString();
  if (mode === "since") {
    const covered = Date.parse(since) >= start;
    console.log(`Slot starts ${slot}; ${since} is ${covered ? "in it: covered" : "before it: not covered"}.`);
    return output(covered);
  }
  const name = file.split("/").pop();
  const runs = JSON.parse(
    gh("run", "list", "-R", repo, "--workflow", name, "--branch", "main", "--created", `>=${slot.slice(0, 19)}Z`, "--limit", "20", "--json", "databaseId,createdAt,status,conclusion"),
  );
  const by = coveredByRuns(runs, self, start);
  console.log(by ? `Slot starting ${slot} is covered by run ${by.databaseId} (${by.status}${by.conclusion ? `, ${by.conclusion}` : ""}).` : `Slot starting ${slot}: no other run covers it.`);
  output(Boolean(by));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
