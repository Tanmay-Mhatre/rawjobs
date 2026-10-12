/**
 * Find boards no list has: try companies we already know on the other hiring systems.
 *
 * - Moved: a board that went dead or empty usually means the company switched systems (Lever ->
 *   Ashby is common) and kept its slug or name. Tried first.
 * - Resolved without a board: companies whose website showed a careers page we couldn't read
 *   (resolve.ts) may still have a board under their name.
 * - Workday tenants whose known site is dead: try the usual site names on the same tenant.
 *
 * A board is accepted only when it is live (jobs > 0) and the hiring system's own name for it is
 * the same company (lib/slugs.ts sameCompany, strict), so "rain" or "kraken" can't sneak in.
 * Workday sites need no name check: the tenant host already belongs to the company.
 *
 * Resumable and time-boxed: every attempt is logged in out/probe.jsonl and not repeated for
 * 90 days. Accepted boards are listed in out/probe-found.json, which merge.ts reads.
 *
 *   pnpm catalog:crossprobe [--max-minutes 60]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { companyKey, guessName, HttpClient } from "../../packages/core/src/index";
import { readChecks } from "./lib/checks";
import { checkBoard, type Board } from "./lib/live-check";
import { normalizeName, slugCandidates } from "./lib/slugs";
import { maxMsFromArgs } from "./lib/time-box";

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "out", "probe.jsonl");
const FOUND = join(here, "out", "probe-found.json");
/** `--max-minutes`, 60 when not given. */
const MAX_MS = process.argv.includes("--max-minutes") ? maxMsFromArgs() : 60 * 60_000;
const RETRY_DAYS = 90;
const WORKERS = 8;
/** Name forms tried per company and system (the known slug comes first). */
const MAX_CANDIDATES = 3;
const SYSTEMS = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;
// ≤ 4 requests/s per API host; Workday tenants are separate hosts.
const http = new HttpClient({ retries: 1, hostDelayMs: 250, timeoutMs: 20_000, backoffMs: 3_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; low-rate board validation)" });

type Attempt = { key: string; company: string; result: "found" | "no board" | "empty" | "other company" | "error"; board?: Omit<Board, "key">; board_name?: string; jobs?: number | null; why?: string; tried_at: string };
type Merged = { key: string; ats: string; slug: string; shard?: string; site?: string; name?: string };
type Job = { company: string; why: string; boards: Board[]; nameCheck: boolean };

/** Board names as the systems show them: "Ramp Jobs" -> "Ramp", "Jobs at Acme" -> "Acme". */
export function cleanBoardName(title: string): string {
  return title
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s*[-|–]\s*(jobs|careers).*$/i, "")
    .replace(/^(jobs|careers|current openings|open positions)\s+(at|@)\s+/i, "")
    .replace(/\s+(jobs|careers|job board)$/i, "")
    .trim();
}

/** Strict: same name once legal and generic words are dropped. */
export function sameCompanyStrict(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return !!x && (x === y || x.replace(/ /g, "") === y.replace(/ /g, ""));
}

async function boardName(b: Board, fromCheck?: string): Promise<string | undefined> {
  if (fromCheck) return fromCheck;
  const page = async (url: string) => (await http.getText(url)).match(/<title>([^<]*)<\/title>/i)?.[1];
  switch (b.ats) {
    case "greenhouse":
      return (await http.getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.slug)}`)).name;
    case "lever":
      return page(`https://jobs.lever.co/${encodeURIComponent(b.slug)}`);
    case "ashby":
      return page(`https://jobs.ashbyhq.com/${encodeURIComponent(b.slug)}`);
  }
  return undefined;
}

async function tryBoard(job: Job, b: Board): Promise<Attempt> {
  const base = { key: b.key, company: job.company, tried_at: new Date().toISOString() };
  const r = await checkBoard(http, b);
  if (r.status === "dead") return { ...base, result: "no board" };
  // Workday answers a wrong site name with an HTTP error: that site doesn't exist.
  if (r.status === "error") return b.ats === "workday" && r.http ? { ...base, result: "no board", why: `HTTP ${r.http}` } : { ...base, result: "error", why: r.error };
  if (r.status !== "live") return { ...base, result: "empty", jobs: r.jobs };
  const { key: _key, ...board } = b;
  if (!job.nameCheck) return { ...base, result: "found", board, jobs: r.jobs };
  let name: string | undefined;
  try {
    name = await boardName(b, r.name);
  } catch (err) {
    return { ...base, result: "error", why: `name: ${(err as Error).message.slice(0, 100)}` };
  }
  const clean = name ? cleanBoardName(name) : undefined;
  if (!clean || !sameCompanyStrict(job.company, clean)) return { ...base, result: "other company", board_name: clean, jobs: r.jobs };
  return { ...base, result: "found", board, board_name: clean, jobs: r.jobs };
}

function workdaySites(tenant: string): string[] {
  const T = tenant.charAt(0).toUpperCase() + tenant.slice(1);
  return [...new Set(["External", "Careers", "careers", "External_Careers", "ExternalCareers", T, `${T}_Careers`, `${T}Careers`, `${T}_External`, `${T}External`, `${T}_External_Careers`, `${tenant}_careers`])];
}

/** What to try this run, and every attempt on record. */
function plan() {
  const merged = (JSON.parse(readFileSync(join(here, "out", "merged.json"), "utf8")) as { boards: Merged[] }).boards;
  const known = new Set(merged.map((b) => b.key));
  // Latest definite result per board (same files check.ts writes).
  const status = readChecks(join(here, "out")) as Map<string, { status: string; name?: string }>;
  const tried = new Map<string, Attempt>();
  const cutoff = Date.now() - RETRY_DAYS * 86_400_000;
  if (existsSync(LOG)) {
    for (const line of readFileSync(LOG, "utf8").split("\n")) {
      if (!line) continue;
      const a = JSON.parse(line) as Attempt;
      if (a.result !== "error" && Date.parse(a.tried_at) >= cutoff) tried.set(`${a.key}|${a.company}`, a);
    }
  }

  const jobs: Job[] = [];
  const seenCompany = new Set<string>();
  const addNameJob = (company: string, why: string, slug: string | undefined, skipAts?: string) => {
    const id = normalizeName(company);
    if (!id || seenCompany.has(id)) return;
    seenCompany.add(id);
    const slugs = slugCandidates(company, slug).slice(0, MAX_CANDIDATES);
    const boards = SYSTEMS.filter((a) => a !== skipAts).flatMap((ats) => slugs.map((s) => ({ ats, slug: s, key: companyKey({ ats, slug: s }) })));
    if (boards.length) jobs.push({ company, why, boards, nameCheck: true });
  };

  // 1. Moved: dead or empty boards on the systems we can search by name.
  const liveTenants = new Set<string>();
  for (const b of merged) {
    const s = status.get(b.key);
    if (b.ats === "workday" && (s?.status === "live" || s?.status === "dormant")) liveTenants.add(`${b.slug}|${b.shard}`.toLowerCase());
  }
  for (const b of merged) {
    const s = status.get(b.key)?.status;
    if (b.ats === "workday" || (s !== "dead" && s !== "dormant")) continue;
    addNameJob(b.name || status.get(b.key)?.name || guessName(b.slug), `${s} ${b.key}`, b.slug, b.ats);
  }
  // 2. Companies whose website had no readable board.
  for (const file of ["resolved.json", "resolved-bulk.json"]) {
    const path = join(here, "out", file);
    if (!existsSync(path)) continue;
    for (const r of (JSON.parse(readFileSync(path, "utf8")) as { companies: { name: string; status: string }[] }).companies) {
      if (r.status === "custom" || r.status === "none") addNameJob(r.name, `website: ${r.status}`, undefined);
    }
  }
  // 3. Workday tenants with no live site.
  const tenants = new Map<string, Merged>();
  for (const b of merged) {
    const id = `${b.slug}|${b.shard}`.toLowerCase();
    if (b.ats === "workday" && !liveTenants.has(id) && !tenants.has(id)) tenants.set(id, b);
  }
  for (const t of tenants.values()) {
    const boards = workdaySites(t.slug).map((site) => ({ ats: "workday", slug: t.slug, shard: t.shard, site, key: companyKey({ ats: "workday", slug: t.slug, shard: t.shard, site }) }));
    jobs.push({ company: t.name || guessName(t.slug), why: `workday tenant without a live site`, boards, nameCheck: false });
  }

  // Boards already in the directory or tried recently are skipped.
  for (const j of jobs) j.boards = j.boards.filter((b) => !known.has(b.key) && !tried.has(`${b.key}|${j.company}`));
  const queue = jobs.filter((j) => j.boards.length);
  console.error(`${queue.length} companies to try (${queue.reduce((n, j) => n + j.boards.length, 0)} boards); ${tried.size} attempts on record`);
  return { queue, tried };
}

async function run() {
  const { queue, tried } = plan();
  const started = Date.now();
  const tally: Record<string, number> = {};
  let done = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      for (let job = queue.shift(); job && Date.now() - started < MAX_MS; job = queue.shift()) {
        for (const b of job.boards) {
          const a = await tryBoard(job, b);
          appendFileSync(LOG, `${JSON.stringify(a)}\n`);
          tried.set(`${a.key}|${a.company}`, a);
          tally[a.result] = (tally[a.result] ?? 0) + 1;
          // One board per company is enough (Workday: one site per tenant).
          if (a.result === "found") {
            console.error(`  found ${a.key} for ${job.company} (${job.why})${a.board_name ? ` as "${a.board_name}"` : ""}`);
            break;
          }
        }
        if (++done % 200 === 0) console.error(`  ${done} companies, ${queue.length} left`, JSON.stringify(tally));
      }
    }),
  );
  // Every accepted board on record, for merge.ts.
  const found = new Map<string, Attempt>();
  for (const a of tried.values()) if (a.result === "found") found.set(a.key, a);
  const boards = [...found.values()].filter((a) => a.board).map((a) => ({ ...a.board!, name: a.board_name ?? a.company }));
  writeFileSync(FOUND, JSON.stringify({ generated_at: new Date().toISOString(), boards }));
  console.error(`${queue.length ? "Out of time; continues next run" : "Done"}.`, tally, `${boards.length} boards found in total`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
