/**
 * Does each hiring system's connector still read jobs? Most of them use endpoints the vendor never
 * documented, so a change on their side doesn't fail loudly: the connector just finds zero jobs. Once
 * a day this picks up to 3 known boards per hiring system from the latest published directory (live,
 * most open jobs, different shards where a system has them), runs the real connector on each (fetch
 * and normalize, as a scan does), and reads each job board once. The Connectors · health workflow runs
 * it and opens an issue when a system fails.
 *
 *   pnpm connector:health [--report report.md] [--only workday,lever]
 *
 * A system FAILS when none of its boards gave usable jobs (each threw, found none, or gave jobs
 * without a title, link or id); WARN when some didn't; SKIPPED when the directory has no live board
 * for it. Exits non-zero only when the check itself breaks, never because a system failed: it writes
 * `failing=<n>` to $GITHUB_OUTPUT and the table to $GITHUB_STEP_SUMMARY instead.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { ATS_TYPES, type CompanyRef, getConnector, HttpClient, JOB_BOARDS, type NormalizedJob } from "@rawjobs/core";

/** A directory row, as directory.json in the latest release has it. */
export type DirRow = { key: string; ats: string; slug: string; name?: string; region?: string; shard?: string; site?: string; status: string; open_jobs?: number | null };
/** One board's result: jobs found, how many lacked a title, link or id, or why it failed. */
export type BoardOutcome = { board: string; jobs: number; bad: number; error?: string };
export type Status = "pass" | "warn" | "fail" | "skipped";
export type SystemResult = { system: string; kind: "hiring system" | "job board"; boards: BoardOutcome[]; status: Status };

/** Boards tried per hiring system. */
export const SAMPLE = 3;
/**
 * Boards with more open jobs than this go last: big lists page through many requests (Workday: 20 a
 * page), and a mid-sized live board shows a broken connector just as well.
 */
export const BIG_BOARD = 200;
/** A board's jobs count as broken when more than this share lacks a title, link or id. */
export const MAX_BAD_SHARE = 0.1;
/** One board gets this long, retries included, before it counts as failed. */
const BOARD_TIMEOUT_MS = 120_000;
/** Systems checked at once (each on its own hosts, one board at a time). */
const LANES = 6;

/**
 * Up to n live boards with open jobs for one system: mid-sized ones first (most open jobs first),
 * then the big ones; a shard (or region) not yet picked wins over one already picked, so a system
 * that runs on several hosts is tried on more than one.
 */
export function pickBoards(rows: readonly DirRow[], ats: string, n = SAMPLE): DirRow[] {
  const jobs = (r: DirRow) => r.open_jobs ?? 0;
  const big = (r: DirRow) => jobs(r) > BIG_BOARD;
  const ranked = rows
    .filter((r) => r.ats === ats && r.status === "live" && jobs(r) > 0)
    .sort((a, b) => Number(big(a)) - Number(big(b)) || (big(a) ? jobs(a) - jobs(b) : jobs(b) - jobs(a)) || a.key.localeCompare(b.key));
  const picked: DirRow[] = [];
  const shards = new Set<string>();
  for (const r of ranked) {
    if (picked.length >= n) break;
    const shard = (r.shard ?? r.region ?? "").toLowerCase();
    if (shards.has(shard)) continue;
    shards.add(shard);
    picked.push(r);
  }
  for (const r of ranked) {
    if (picked.length >= n) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

/** Jobs missing what every job needs: something to show (title), to open (url) and to track (id). */
export function countBad(jobs: readonly Pick<NormalizedJob, "id" | "title" | "url">[]): number {
  return jobs.filter((j) => !j.id?.trim() || !j.title?.trim() || !j.url?.trim()).length;
}

export function boardOk(o: BoardOutcome): boolean {
  return !o.error && o.jobs > 0 && o.bad <= o.jobs * MAX_BAD_SHARE;
}

export function classify(boards: readonly BoardOutcome[]): Status {
  if (!boards.length) return "skipped";
  const ok = boards.filter(boardOk).length;
  return ok === boards.length ? "pass" : ok === 0 ? "fail" : "warn";
}

/** Why a board didn't count, in a few words. */
export function problemOf(o: BoardOutcome): string | null {
  if (o.error) return `${o.board}: ${o.error}`;
  if (!o.jobs) return `${o.board}: 0 jobs`;
  if (!boardOk(o)) return `${o.board}: ${o.bad}/${o.jobs} jobs lack title, link or id`;
  return null;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const LABEL: Record<Status, string> = { pass: "pass", warn: "**WARN**", fail: "**FAIL**", skipped: "skipped" };
const ORDER: Record<Status, number> = { fail: 0, warn: 1, skipped: 2, pass: 3 };

/** The table: one row per system, failing ones first. */
export function renderTable(results: readonly SystemResult[]): string {
  const rows = [...results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.system.localeCompare(b.system));
  const lines = ["| System | Boards tried | Jobs found | Status | Errors |", "| --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    const tried = r.boards.length ? r.boards.map((b) => b.board).join(", ") : "none live in the directory";
    const jobs = r.boards.length ? r.boards.map((b) => (b.error ? "-" : String(b.jobs))).join(" / ") : "-";
    const errors = r.boards.flatMap((b) => problemOf(b) ?? []).join("; ");
    const name = r.kind === "job board" ? `${r.system} (job board)` : r.system;
    lines.push(`| ${cell(name)} | ${cell(tried)} | ${jobs} | ${LABEL[r.status]} | ${cell(errors.slice(0, 300))} |`);
  }
  return lines.join("\n");
}

export const failing = (results: readonly SystemResult[]) => results.filter((r) => r.status === "fail");

/** The step summary and the issue's body. */
export function reportMarkdown(results: readonly SystemResult[]): string {
  const n = (s: Status) => results.filter((r) => r.status === s).length;
  const bad = failing(results);
  const lines = [
    bad.length ? `${bad.length} of ${results.length} hiring systems and job boards found no usable jobs:` : "Every hiring system and job board checked found jobs.",
    "",
    ...bad.map((r) => `- **${r.system}**: ${r.boards.flatMap((b) => problemOf(b) ?? []).join("; ")}`),
    ...(bad.length ? [""] : []),
    `${n("pass")} pass, ${n("warn")} warn, ${n("fail")} fail, ${n("skipped")} skipped (no live board in the directory to try).`,
    "",
    renderTable(results),
    "",
    "A failing system's connector most likely needs an update for a change on the vendor's side (`packages/core/src/connectors/`). " +
      "Checked by the **Connectors · health** workflow (`scripts/catalog/connector-health.ts`). This issue closes itself once no system fails.",
  ];
  return `${lines.join("\n")}\n`;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer in ${ms / 1000}s`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

/** Fetch and normalize one board with its connector, as a scan does. */
async function tryBoard(http: HttpClient, ats: string, row: Pick<DirRow, "slug" | "name" | "region" | "shard" | "site">, label: string): Promise<BoardOutcome> {
  const connector = getConnector(ats as CompanyRef["ats"]);
  if (!connector) return { board: label, jobs: 0, bad: 0, error: "no connector" };
  const ref = {
    name: row.name || row.slug,
    ats,
    slug: row.slug,
    enabled: true,
    ...(row.region ? { region: row.region } : {}),
    ...(row.shard ? { shard: row.shard } : {}),
    ...(row.site ? { site: row.site } : {}),
  } as CompanyRef;
  try {
    const jobs = await withTimeout(
      (async () => {
        const raws = await connector.fetch(ref, { http, now: new Date(), partial: () => {} });
        return raws.map((r) => connector.normalize(r, ref));
      })(),
      BOARD_TIMEOUT_MS,
    );
    return { board: label, jobs: jobs.length, bad: countBad(jobs) };
  } catch (e) {
    const err = e as Error & { status?: number };
    const message = err.message ?? String(e);
    const status = err.status && !message.includes(`HTTP ${err.status}`) ? `HTTP ${err.status} ` : "";
    return { board: label, jobs: 0, bad: 0, error: `${status}${message}`.slice(0, 140) };
  }
}

/** The job boards' own idea of "everything": what pasting their link gives (connector detect()). */
const BOARD_SLUG: Record<string, string> = { hackernews: "whoishiring" };

export async function checkAll(rows: readonly DirRow[], opts: { http: HttpClient; only?: Set<string>; log?: (s: string) => void }): Promise<SystemResult[]> {
  const log = opts.log ?? (() => {});
  const want = (s: string) => !opts.only || opts.only.has(s);
  const work: (() => Promise<SystemResult>)[] = [];
  for (const ats of ATS_TYPES.filter(want)) {
    work.push(async () => {
      const boards: BoardOutcome[] = [];
      for (const b of pickBoards(rows, ats)) boards.push(await tryBoard(opts.http, ats, b, b.site ? `${b.slug}/${b.site}` : b.slug));
      const r: SystemResult = { system: ats, kind: "hiring system", boards, status: classify(boards) };
      log(`${ats}: ${r.status} (${boards.map((b) => (b.error ? "error" : b.jobs)).join(", ") || "no boards"})`);
      return r;
    });
  }
  for (const ats of JOB_BOARDS.filter(want)) {
    work.push(async () => {
      const slug = BOARD_SLUG[ats] ?? "all";
      const boards = [await tryBoard(opts.http, ats, { slug, name: ats }, slug)];
      const r: SystemResult = { system: ats, kind: "job board", boards, status: classify(boards) };
      log(`${ats}: ${r.status} (${boards[0]!.error ? "error" : boards[0]!.jobs})`);
      return r;
    });
  }
  const results: SystemResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: LANES }, async () => {
      while (next < work.length) results.push(await work[next++]!());
    }),
  );
  return results;
}

/** The latest published directory's rows. */
export async function loadDirectory(base: string, fetchImpl: typeof fetch = fetch): Promise<DirRow[]> {
  const res = await fetchImpl(`${base}/directory.json.gz`, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`directory.json.gz: HTTP ${res.status}`);
  const d = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as { companies?: DirRow[] };
  if (!Array.isArray(d.companies)) throw new Error("directory.json.gz has no companies list");
  return d.companies;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const repo = process.env.DATA_REPO || "Tanmay-Mhatre/rawjobs-directory";
  const base = (process.env.RAWJOBS_DIRECTORY_URL || `https://github.com/${repo}/releases/latest/download`).replace(/\/$/, "");
  const only = arg("--only") ? new Set(arg("--only")!.split(",")) : undefined;
  const http = new HttpClient({
    retries: 1,
    timeoutMs: 20_000,
    hostDelayMs: 1_000,
    backoffMs: 3_000,
    userAgent: "RawJobs-catalog/0.1 (open-source job radar; daily connector health check, a few requests per system)",
  });
  const rows = await loadDirectory(base);
  console.error(`${rows.length} directory rows; checking ${only ? [...only].join(", ") : "every hiring system and job board"}`);
  const results = await checkAll(rows, { http, only, log: (s) => console.error(`  ${s}`) });
  const md = reportMarkdown(results);
  console.log(md);
  const report = arg("--report");
  if (report) writeFileSync(report, md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Connector health\n\n${md}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `failing=${failing(results).length}\n`);
  // A connector left waiting on a socket mustn't hold the run open.
  process.exit(0);
}
