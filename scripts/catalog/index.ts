/**
 * Collect each live company's open jobs as slim rows (title, location, workplace, age), so a user's
 * copy can see which companies have jobs that pass *their* filters. No descriptions are kept.
 * Resumable, one output file per process (like check.ts).
 *
 *   pnpm exec tsx scripts/catalog/index.ts --ats greenhouse
 *   pnpm exec tsx scripts/catalog/index.ts --ats lever,ashby,smartrecruiters
 *   --max-age-days 7   re-fetch companies indexed more than 7 days ago
 *   --max-minutes 30   stop starting new companies after 30 minutes (rows are appended as they
 *                      come, and publish keeps each company's newest row, so stopping loses nothing)
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConnector, HttpClient, HttpError, inferWorkplace, type CompanyRef, type NormalizedJob } from "../../packages/core/src/index";
import { maxMsFromArgs, nextInTime } from "./lib/time-box";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "out");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ONLY = new Set((arg("--ats") ?? "greenhouse,lever,ashby,smartrecruiters").split(","));
const MAX_AGE_DAYS = Number(arg("--max-age-days") ?? 30);
const MAX_MS = maxMsFromArgs();
const OUT = join(OUT_DIR, `index-${[...ONLY].sort().join("-")}.jsonl`);
/** Rows kept per company after merging duplicates (newest first). */
const MAX_ROWS = 300;
const WORKERS: Record<string, number> = { greenhouse: 2, lever: 2, ashby: 2, smartrecruiters: 2 };

const http = new HttpClient({ retries: 2, hostDelayMs: 250, timeoutMs: 30_000, backoffMs: 3_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; low-rate board index)" });

type Entry = { key: string; ats: string; slug: string; region?: string; name: string; status: string };
/** [title, location, workplace, ageDays, count] */
type Row = [string, string, string, number | null, number];

/** Greenhouse without descriptions: the light list is enough for titles and locations. */
async function greenhouseLight(ref: CompanyRef): Promise<NormalizedJob[]> {
  type G = { id: number; title: string; location?: { name?: string }; absolute_url: string; first_published?: string; updated_at?: string };
  const d = await http.getJson<{ jobs?: G[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.slug)}/jobs`);
  return (d.jobs ?? []).map((j) => {
    const location = j.location?.name?.trim() ?? "";
    return { id: String(j.id), ats: "greenhouse", company: ref.name, title: j.title.trim(), location, workplace: inferWorkplace(location), postedAt: j.first_published ?? j.updated_at, url: j.absolute_url };
  });
}

async function fetchJobs(e: Entry): Promise<NormalizedJob[]> {
  const ref = { name: e.name, ats: e.ats, slug: e.slug, region: e.region, enabled: true } as CompanyRef;
  if (e.ats === "greenhouse") return greenhouseLight(ref);
  const c = getConnector(ref.ats)!;
  const raws = await c.fetch(ref, { http, now: new Date() });
  return raws.map((r) => c.normalize(r, ref));
}

function toRows(jobs: NormalizedJob[], now: number): Row[] {
  const merged = new Map<string, Row>();
  for (const j of jobs) {
    const age = j.postedAt ? Math.max(0, Math.round((now - Date.parse(j.postedAt)) / 86_400_000)) : null;
    const k = `${j.title}\u0000${j.location}`;
    const prev = merged.get(k);
    if (prev) {
      prev[4]++;
      if (age !== null && (prev[3] === null || age < prev[3])) prev[3] = age;
    } else merged.set(k, [j.title, j.location, j.workplace, Number.isFinite(age) ? age : null, 1]);
  }
  return [...merged.values()].sort((a, b) => (a[3] ?? 9999) - (b[3] ?? 9999)).slice(0, MAX_ROWS);
}

async function main() {
  const dir = JSON.parse(readFileSync(join(OUT_DIR, "directory.json"), "utf8")) as { companies: Entry[] };
  const fresh = new Set<string>();
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const f of readdirSync(OUT_DIR).filter((n) => /^index-.+\.jsonl$/.test(n))) {
    for (const line of readFileSync(join(OUT_DIR, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as { key: string; fetched_at: string; error?: string };
      if (!r.error && Date.parse(r.fetched_at) >= cutoff) fresh.add(r.key);
    }
  }
  const todo = dir.companies.filter((c) => c.status === "live" && ONLY.has(c.ats) && !fresh.has(c.key));
  console.error(`${todo.length} companies to index (${fresh.size} already fresh)`);

  const lanes = new Map<string, Entry[]>();
  for (const e of todo) {
    if (!lanes.has(e.ats)) lanes.set(e.ats, []);
    lanes.get(e.ats)!.push(e);
  }
  let n = 0;
  const started = Date.now();
  await Promise.all(
    [...lanes.entries()].flatMap(([ats, list]) =>
      Array.from({ length: WORKERS[ats] ?? 1 }, async () => {
        for (let e = nextInTime(list, started, MAX_MS); e; e = nextInTime(list, started, MAX_MS)) {
          let line: Record<string, unknown>;
          try {
            const jobs = await fetchJobs(e);
            line = { key: e.key, fetched_at: new Date().toISOString(), open_jobs: jobs.length, rows: toRows(jobs, Date.now()) };
          } catch (err) {
            const h = err as HttpError;
            line = { key: e.key, fetched_at: new Date().toISOString(), error: `${h.status ?? ""} ${h.message}`.trim().slice(0, 120) };
          }
          appendFileSync(OUT, `${JSON.stringify(line)}\n`);
          if (++n % 250 === 0) {
            const rate = n / ((Date.now() - started) / 1000);
            console.error(`  ${n}/${todo.length} (${rate.toFixed(1)}/s, ~${Math.round((todo.length - n) / rate / 60)} min left)`);
          }
        }
      }),
    ),
  );
  const left = [...lanes.values()].reduce((sum, list) => sum + list.length, 0);
  console.error(left ? `Stopped after ${MAX_MS / 60_000} min: ${left} left for the next run.` : "Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
