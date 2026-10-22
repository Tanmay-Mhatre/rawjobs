/**
 * Find which hiring system each seed company uses (scripts/catalog/seeds/industries.json), by
 * reading its website the way a person would: homepage -> careers link -> the board it embeds or
 * links to. No AI, no search engines. Polite: one request at a time per site, robots.txt honoured,
 * at most 8 pages per company.
 *
 *   pnpm exec tsx scripts/catalog/resolve.ts [--force] [--only "eToro,Plus500"]
 *     -> scripts/catalog/out/resolved.json (kept between runs; results younger than 30 days are reused)
 *
 * --bulk resolves the broad Wikidata list (seeds-bulk.ts) instead, a rotating batch per run
 * (--limit, default 2000): never-resolved companies first, in a fixed pseudo-random order so every
 * batch is a fair sample, then the oldest results. Results are reused for 90 days.
 *     -> scripts/catalog/out/resolved-bulk.json
 *
 * --max-minutes N stops starting new companies after N minutes and saves what was resolved; the
 * rest are due again next run. Results are also saved every 100 companies and when the process is
 * stopped (SIGTERM from the rebuild's hard cap), so a killed run keeps its work.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atsHints, careersLinks, findBoards, HttpClient, HttpError, type FoundBoard } from "@rawjobs/core";
import { writeFileAtomic } from "./lib/fs";
import { keepBoardOnError } from "./lib/resolved";
import { maxMsFromArgs, nextInTime } from "./lib/time-box";

const here = dirname(fileURLToPath(import.meta.url));
const BULK = process.argv.includes("--bulk");
const OUT = join(here, "out", BULK ? "resolved-bulk.json" : "resolved.json");
const SEEDS = BULK ? join(here, "raw", "wikidata", "companies.json") : join(here, "seeds", "industries.json");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : BULK ? 2000 : Infinity;
const FORCE = process.argv.includes("--force");
const MAX_MS = maxMsFromArgs();
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > 0 ? new Set(process.argv[onlyArg + 1]!.split(",").map((s) => s.trim().toLowerCase())) : null;
const MAX_PAGES = 8;
// Every company is a different website, so bulk runs can use more workers without loading any one host
// (HttpClient still spaces requests to each host by hostDelayMs).
const WORKERS = BULK ? 32 : 6;
const REUSE_DAYS = BULK ? 90 : 30;
// Some sites only serve a full page to browser-like clients; say who we are anyway.
const UA = "Mozilla/5.0 (compatible; RawJobs-resolver/0.1; open-source job radar; reads public careers pages)";
const http = new HttpClient({ retries: 1, hostDelayMs: 1_000, timeoutMs: 15_000, backoffMs: 2_000, userAgent: UA });

export type Seed = { name: string; website: string; industries: string[]; careers_url?: string; region?: string };
export type Resolved = {
  name: string;
  website: string;
  industries: string[];
  /** board: found a hiring-system board · custom: found a careers page, no known system · none: no careers page found · error: site unreachable */
  status: "board" | "custom" | "none" | "error";
  board?: Pick<FoundBoard, "ats" | "slug" | "region" | "shard" | "site" | "key" | "supported"> & { name?: string };
  /** Other boards seen on the way (e.g. a second region). */
  also?: string[];
  careers_url?: string;
  evidence?: string;
  /** Hiring systems the careers pages mention without a board link we can read (e.g. a Comeet script). */
  hints?: string[];
  pages: number;
  error?: string;
  resolved_at: string;
};

const robotsCache = new Map<string, Promise<string[]>>();
/** Disallowed path prefixes for "User-agent: *" (good enough for careers pages). */
function disallowed(origin: string): Promise<string[]> {
  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      http
        .getText(`${origin}/robots.txt`)
        .then((txt) => {
          const rules: string[] = [];
          let applies = false;
          for (const line of txt.split(/\r?\n/)) {
            const [k, ...rest] = line.split(":");
            const v = rest.join(":").trim();
            if (/^user-agent$/i.test(k!.trim())) applies = v === "*";
            else if (applies && /^disallow$/i.test(k!.trim()) && v) rules.push(v);
          }
          return rules;
        })
        .catch(() => []),
    );
  }
  return robotsCache.get(origin)!;
}

async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  const u = new URL(url);
  const rules = await disallowed(u.origin);
  if (rules.some((r) => r !== "/" && u.pathname.startsWith(r)) || rules.includes("/")) return null;
  const res = await http.request(url, { redirect: "follow", headers: { accept: "text/html,*/*" } });
  const type = res.headers.get("content-type") ?? "";
  if (!/html|text\/plain/.test(type)) {
    await res.body?.cancel().catch(() => {});
    return { url: res.url || url, html: "" };
  }
  return { url: res.url || url, html: (await res.text()).slice(0, 2_000_000) };
}

async function resolveSeed(seed: Seed): Promise<Resolved> {
  const base: Omit<Resolved, "status" | "pages"> = { name: seed.name, website: seed.website, industries: seed.industries, resolved_at: new Date().toISOString() };
  const domain = seed.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // The bare domain usually redirects to the right homepage (www., a language path…).
  const home = `https://${domain}/`;
  const queue: string[] = [];
  const push = (...urls: string[]) => {
    for (const u of urls) if (!queue.includes(u)) queue.push(u);
  };
  if (seed.careers_url) push(seed.careers_url);
  push(home);
  const bare = domain.replace(/^www\./, "");
  const fallbacks = [
    `https://${bare}/careers`,
    `https://www.${bare}/careers`,
    `https://careers.${bare}/`,
    `https://${bare}/en/careers`,
    `https://${bare}/jobs`,
    `https://jobs.${bare}/`,
    `https://${bare}/company/careers`,
    `https://${bare}/about/careers`,
  ];

  let pages = 0;
  /** Pages that answered: a site that loaded but had no careers page is "none", not "error". */
  let loaded = 0;
  let careersPage: string | undefined;
  let lastError: string | undefined;
  const found: FoundBoard[] = [];
  const hints = new Set<string>();
  for (let i = 0; i < queue.length + fallbacks.length && pages < MAX_PAGES; i++) {
    const url = i < queue.length ? queue[i]! : fallbacks[i - queue.length]!;
    let page: { url: string; html: string } | null;
    try {
      page = await fetchPage(url);
    } catch (err) {
      lastError = err instanceof HttpError ? err.message : (err as Error).message;
      continue;
    } finally {
      pages++;
    }
    if (!page) continue;
    loaded++;
    const boards = findBoards(page.html, page.url);
    if (/career|jobs|join|vacanc/i.test(page.url)) for (const h of atsHints(page.html)) hints.add(h);
    for (const b of boards) if (!found.some((f) => f.key === b.key)) found.push(b);
    if (found.some((b) => b.supported)) break;
    // Remember the first careers-looking page we reached, and follow its links.
    if (/career|jobs|join|vacanc/i.test(page.url) && !careersPage && page.html) careersPage = page.url;
    if (page.html) push(...careersLinks(page.html, page.url).slice(0, 4));
  }

  if (found.length) {
    const best = found.sort((a, b) => Number(b.supported) - Number(a.supported))[0]!;
    const { ats, slug, region, shard, site, key, supported } = best;
    return {
      ...base,
      status: "board",
      board: { ats, slug, ...(region ? { region } : {}), ...(shard ? { shard } : {}), ...(site ? { site } : {}), key, supported },
      ...(found.length > 1 ? { also: found.slice(1, 4).map((f) => f.key) } : {}),
      evidence: best.evidence,
      careers_url: careersPage,
      pages,
    };
  }
  if (careersPage) return { ...base, status: "custom", careers_url: careersPage, ...(hints.size ? { hints: [...hints] } : {}), pages };
  return { ...base, status: lastError && !loaded ? "error" : "none", ...(lastError ? { error: lastError.slice(0, 160) } : {}), pages };
}

/** A fixed pseudo-random rank per name (FNV-1a), so batches are a fair sample and stable across runs. */
function sampleOrder(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

async function main() {
  if (!existsSync(SEEDS)) throw new Error(`${SEEDS} missing${BULK ? " (run: pnpm catalog:seeds-bulk)" : ""}`);
  const seeds = (JSON.parse(readFileSync(SEEDS, "utf8")) as { companies: Seed[] }).companies;
  const previous = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { companies: Resolved[] }).companies : [];
  const byName = new Map(previous.map((r) => [r.name.toLowerCase(), r]));
  const fresh = (r: Resolved | undefined) => r && r.status !== "error" && Date.now() - Date.parse(r.resolved_at) < REUSE_DAYS * 86_400_000;

  const due = seeds.filter((s) => (ONLY ? ONLY.has(s.name.toLowerCase()) : FORCE || !fresh(byName.get(s.name.toLowerCase()))));
  const age = (s: Seed) => {
    const r = byName.get(s.name.toLowerCase());
    return r ? Date.parse(r.resolved_at) : 0;
  };
  const todo = due.sort((a, b) => age(a) - age(b) || sampleOrder(a.name) - sampleOrder(b.name)).slice(0, LIMIT);
  console.error(`${seeds.length} seeds, ${due.length} due, resolving ${todo.length}`);
  let done = 0;
  // Keep only current seeds, in seed order.
  const save = () => {
    const companies = seeds.map((s) => byName.get(s.name.toLowerCase())).filter((r): r is Resolved => !!r);
    writeFileAtomic(OUT, JSON.stringify({ generated_at: new Date().toISOString(), companies }, null, 1));
    return companies;
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      save();
      console.error(`Stopped (${signal}) after ${done} of ${todo.length}; saved what was resolved.`);
      process.exit(143);
    });
  const queue = [...todo];
  const started = Date.now();
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      for (let s = nextInTime(queue, started, MAX_MS); s; s = nextInTime(queue, started, MAX_MS)) {
        const r = await resolveSeed(s).catch(
          (err): Resolved => ({ name: s!.name, website: s!.website, industries: s!.industries, status: "error", error: String(err).slice(0, 160), pages: 0, resolved_at: new Date().toISOString() }),
        );
        byName.set(s.name.toLowerCase(), keepBoardOnError(byName.get(s.name.toLowerCase()), r));
        if (++done % 100 === 0) save();
        console.error(`  [${done}/${todo.length}] ${s.name}: ${r.status}${r.board ? ` ${r.board.key}${r.board.supported ? "" : " (not scannable yet)"}` : r.careers_url ? ` ${r.careers_url}` : ""}`);
      }
    }),
  );
  const companies = save();
  const tally: Record<string, number> = {};
  for (const r of companies) tally[r.status] = (tally[r.status] ?? 0) + 1;
  console.error(queue.length ? `Stopped after ${MAX_MS / 60_000} min: ${queue.length} left for the next run.` : "Done.", tally);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
