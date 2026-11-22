/**
 * Workday companies' own careers sites. Since 16 Nov 2026 Workday's Cloudflare turns automated
 * readers away, but many big employers also run a careers site of their own on a hiring system we
 * can read (Phenom: careers.adobe.com; Radancy: jobs.boeing.com; Eightfold: explore.jobs.netflix.net;
 * iCIMS, Avature, SuccessFactors…). This finds that site and adds it to the directory as another
 * board of the same company; publish.ts then joins the two (`same_as`, the site leading), so the
 * Radar shows each opening once and scans read the site instead of the Workday board.
 *
 * Only the company's own website and the careers sites it links to on its own domains are read, the
 * way resolve.ts reads a website: never a Workday host. robots.txt is honoured, at most MAX_PAGES
 * pages per company, one request at a time per site. A site is accepted only when it is live
 * (jobs > 0) and its host or board id carries the company's name (lib/own-sites.ts ownedBy).
 *
 * Inputs (the catalog's working state): out/checks.jsonl (Workday boards and their last definite
 * check), out/resolved*.json (websites that led to a Workday board), raw/wikidata/companies.json.
 * Every attempt is logged in out/own-sites.jsonl and not repeated for RETRY_DAYS (errors: next run).
 * Accepted sites are listed in out/own-sites.json, which merge.ts and publish.ts read.
 *
 *   pnpm exec tsx scripts/catalog/own-sites.ts [--max-minutes 20] [--only adobe,boeing] [--limit N] [--dry-run]
 *
 * --dry-run reads and probes but writes nothing, and prints what it would add.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atsHints, companyKey, findBoards, guessName, HttpClient, robotsAllows } from "@rawjobs/core";
import { readChecks } from "./lib/checks";
import { writeFileAtomic } from "./lib/fs";
import { checkBoard, type Board } from "./lib/live-check";
import { isTenantSite, ownCareersLink, ownedBy, ownerLabels, planTenants, type Tenant } from "./lib/own-sites";
import { maxMsFromArgs, nextInTime } from "./lib/time-box";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out");
const LOG = join(OUT, "own-sites.jsonl");
const FOUND = join(OUT, "own-sites.json");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const MAX_MS = maxMsFromArgs();
const DRY = process.argv.includes("--dry-run");
const ONLY = arg("--only")
  ? new Set(
      arg("--only")!
        .split(",")
        .map((s) => s.trim().toLowerCase()),
    )
  : null;
const LIMIT = Number(arg("--limit") ?? Infinity);
const RETRY_DAYS = 90;
const MAX_PAGES = 10;
/** Websites read per tenant (a subsidiary's site can lead to the same Workday tenant). */
const MAX_WEBSITES = 2;
/** Every company is a different site; HttpClient spaces requests to each host. */
const WORKERS = 16;
/** Systems that live on a company's own host and are recognised by their page's traces (find-boards.ts HINTS). */
const HOST_SYSTEMS = ["phenom", "radancy", "eightfold"] as const;
const UA = "Mozilla/5.0 (compatible; RawJobs-resolver/0.1; open-source job radar; reads public careers pages)";
const http = new HttpClient({ retries: 1, hostDelayMs: 1_000, timeoutMs: 15_000, backoffMs: 2_000, userAgent: UA });

type Found = Omit<Board, "key"> & { key: string; name: string; jobs: number | null };
export type Attempt = {
  tenant: string;
  result: "found" | "none" | "error";
  board?: Found;
  /** The tenant's Workday boards the site stands in for. */
  replaces?: string[];
  website?: string;
  evidence?: string;
  pages: number;
  why?: string;
  tried_at: string;
};
/** out/own-sites.json: one entry per accepted site. */
export type OwnSitesFile = { generated_at: string; boards: (Found & { replaces: string[]; website: string; evidence: string })[] };

async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  if (!(await robotsAllows(http, url))) return null;
  const res = await http.request(url, { redirect: "follow", headers: { accept: "text/html,*/*" } });
  if (!/html/.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  return { url: res.url || url, html: (await res.text()).slice(0, 2_000_000) };
}

/** Links on a page to the company's careers pages, on any of its domains (adobe.com -> careers.adobe.com). */
function careersLinksOf(html: string, base: string, labels: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
      u.hash = "";
      if (ownCareersLink(u.href, labels) && !out.includes(u.href)) out.push(u.href);
    } catch {
      // not a URL
    }
  }
  return out;
}

/** The company's name from a website that is the tenant's company itself (never a subsidiary's name). */
const companyName = (t: Tenant, w: Tenant["websites"][number]): string => (isTenantSite(t.tenant, w.website) ? w.name : t.websites.find((x) => isTenantSite(t.tenant, x.website))?.name) ?? "";

/** Read one tenant's websites until a careers site we can read turns up live. */
async function tryTenant(t: Tenant): Promise<Attempt> {
  const base = { tenant: t.id, tried_at: new Date().toISOString() };
  const labels = ownerLabels(t);
  if (!labels.length) return { ...base, result: "none", pages: 0, why: "no name long enough to check ownership" };
  let pages = 0;
  let loaded = 0;
  let lastError: string | undefined;
  const probed = new Set<string>();
  for (const w of t.websites.slice(0, MAX_WEBSITES)) {
    const domain = w.website
      .replace(/^https?:\/\//i, "")
      .replace(/[/?#].*$/, "")
      .toLowerCase();
    const bare = domain.replace(/^www\./, "");
    const queue = [`https://${domain}/`, `https://careers.${bare}/`, `https://jobs.${bare}/`, `https://${bare}/careers`];
    for (let i = 0; i < queue.length && pages < MAX_PAGES; i++) {
      let page: { url: string; html: string } | null;
      try {
        pages++;
        page = await fetchPage(queue[i]!);
      } catch (err) {
        lastError = (err as Error).message.slice(0, 160);
        continue;
      }
      if (!page) continue;
      loaded++;
      const host = new URL(page.url).hostname.toLowerCase();
      // Candidates: boards the page links to (not Workday's), then the page's own host when it carries
      // a host-based system's traces.
      const candidates: Omit<Board, "key">[] = findBoards(page.html, page.url)
        .filter((b) => b.supported && b.ats !== "workday" && ownedBy(b, labels))
        .map(({ ats, slug, region, shard, site }) => ({ ats, slug, ...(region ? { region } : {}), ...(shard ? { shard } : {}), ...(site ? { site } : {}) }));
      if (ownedBy({ slug: host }, labels) && /career|jobs?\b|join|vacanc|opportunit/i.test(page.url)) {
        const hints = atsHints(page.html);
        for (const ats of HOST_SYSTEMS) if (hints.includes(ats)) candidates.push({ ats, slug: host });
      }
      for (const c of candidates) {
        const key = companyKey(c);
        if (probed.has(key)) continue;
        probed.add(key);
        const r = await checkBoard(http, { key, ...c });
        if (r.status === "live" && r.jobs !== 0) {
          return {
            ...base,
            result: "found",
            board: { key, ...c, name: companyName(t, w) || r.name || guessName(t.tenant), jobs: r.jobs },
            replaces: t.boards,
            website: w.website,
            evidence: page.url,
            pages,
          };
        }
      }
      for (const link of careersLinksOf(page.html, page.url, labels).slice(0, 4)) if (!queue.includes(link)) queue.push(link);
    }
  }
  return { ...base, result: lastError && !loaded ? "error" : "none", pages, ...(lastError ? { why: lastError } : {}) };
}

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

async function main() {
  const checks = readChecks(OUT) as Map<string, { status: string; jobs?: unknown }>;
  const resolved = [OUT + "/resolved.json", OUT + "/resolved-bulk.json"].flatMap(
    (f) => readJson<{ companies: { name: string; website: string; board?: { key: string }; also?: string[] }[] }>(f, { companies: [] }).companies,
  );
  const wikidata = readJson<{ companies: { name: string; website: string }[] }>(join(here, "raw", "wikidata", "companies.json"), { companies: [] }).companies;
  const tenants = planTenants(checks, resolved, wikidata);

  const tried = new Map<string, Attempt>();
  const cutoff = Date.now() - RETRY_DAYS * 86_400_000;
  if (existsSync(LOG)) {
    for (const line of readFileSync(LOG, "utf8").split("\n")) {
      if (!line) continue;
      const a = JSON.parse(line) as Attempt;
      if (a.result !== "error" && Date.parse(a.tried_at) >= cutoff) tried.set(a.tenant, a);
    }
  }
  const queue = tenants.filter((t) => (ONLY ? ONLY.has(t.tenant) || ONLY.has(t.id) : !tried.has(t.id)) && t.websites.length).slice(0, LIMIT);
  const jobsIn = (list: readonly Tenant[]) => list.reduce((n, t) => n + t.jobs, 0);
  console.error(
    `${tenants.length} Workday tenants with a live board (${jobsIn(tenants)} jobs); ${tenants.filter((t) => t.websites.length).length} with a website to read; trying ${queue.length} (${jobsIn(queue)} jobs); ${tried.size} on record`,
  );

  const started = Date.now();
  const tally: Record<string, number> = {};
  const done: { t: Tenant; a: Attempt }[] = [];
  const work = [...queue];
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      for (let t = nextInTime(work, started, MAX_MS); t; t = nextInTime(work, started, MAX_MS)) {
        const a = await tryTenant(t).catch((err): Attempt => ({ tenant: t!.id, result: "error", pages: 0, why: String(err).slice(0, 160), tried_at: new Date().toISOString() }));
        if (!DRY) appendFileSync(LOG, `${JSON.stringify(a)}\n`);
        tried.set(a.tenant, a);
        done.push({ t, a });
        tally[a.result] = (tally[a.result] ?? 0) + 1;
        if (a.board) console.error(`  found ${a.board.key} (${a.board.jobs ?? "?"} jobs) for ${t.id} via ${a.website}`);
        if (done.length % 100 === 0) console.error(`  ${done.length} tenants, ${work.length} left`, JSON.stringify(tally));
      }
    }),
  );

  const found = done.filter((d) => d.a.result === "found");
  console.error(
    `${work.length ? "Out of time; continues next run" : "Done"}.`,
    tally,
    `this run: ${found.length} of ${done.length} tenants (${jobsIn(found.map((d) => d.t))} of ${jobsIn(done.map((d) => d.t))} Workday jobs) have an own careers site we can read`,
  );
  if (DRY) {
    console.log(
      JSON.stringify(
        found.map((d) => ({ tenant: d.t.id, workday_jobs: d.t.jobs, board: d.a.board, website: d.a.website, evidence: d.a.evidence })),
        null,
        1,
      ),
    );
    return;
  }
  // Every accepted site on record, for merge.ts and publish.ts.
  const file: OwnSitesFile = {
    generated_at: new Date().toISOString(),
    boards: [...tried.values()].flatMap((a) => (a.result === "found" && a.board ? [{ ...a.board, replaces: a.replaces ?? [], website: a.website ?? "", evidence: a.evidence ?? "" }] : [])),
  };
  writeFileAtomic(FOUND, JSON.stringify(file, null, 1));
  console.error(`${file.boards.length} own careers sites on record.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
