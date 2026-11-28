import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configToYaml } from "@rawjobs/core/yaml-writer";
import * as demo from "../design/demo-data";

/**
 * A RawJobs folder (RAWJOBS_HOME) filled with the design screenshots' demo data: a config, a résumé,
 * scan results and a company directory. The e2e smoke test runs the real server on it; nothing in it
 * is anyone's real data. `empty: true` leaves it empty, as on a first run.
 */
export function seedHome(home: string, { empty = false, now = new Date() }: { empty?: boolean; now?: Date } = {}): void {
  mkdirSync(home, { recursive: true });
  if (empty) return;
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  };
  // The demo data is pinned to demo.NOW (for stable screenshots); move it to today, or the Radar
  // would file every job under "older".
  const json = (path: string, value: unknown) => put(path, JSON.stringify(shiftDates(value, now.getTime() - demo.NOW.getTime())));
  put("rawjobs.config.local.yaml", configToYaml(demo.CONFIG));
  put("profile/resume.md", demo.RESUME_TEXT);
  json("data/jobs.json", demo.JOBS);
  json("data/jobs-other.json", demo.JOBS_OTHER);
  json("data/meta.json", demo.META);
  json("data/discover.json", demo.DISCOVER);
  json("data/descriptions.json", demo.DESCRIPTIONS);
  json("data/catalog/directory.json", demo.DIRECTORY);
  json("data/catalog/additions.json", { companies: [] });
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Every ISO timestamp in `value` moved by `ms`. */
export function shiftDates<T>(value: T, ms: number): T {
  if (typeof value === "string") return (ISO.test(value) ? new Date(Date.parse(value) + ms).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, ms)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, ms)])) as T;
  return value;
}

if (process.argv[1]?.endsWith("seed-home.ts")) {
  const [home, flag] = process.argv.slice(2);
  if (!home) throw new Error("Usage: tsx scripts/e2e/seed-home.ts <folder> [--empty]");
  seedHome(home, { empty: flag === "--empty" });
  console.log(`Seeded ${home}${flag === "--empty" ? " (empty)" : ""}.`);
}
