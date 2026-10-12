#!/usr/bin/env -S npx tsx
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  defaultDataDir,
  rawjobsHome,
  CODE_ROOT,
  schedulerCommand,
  checkCompanies,
  directoryIndustryCounts,
  companyKey,
  ConfigError,
  connectors,
  detectCompany,
  loadConfig,
  readResume,
  deleteResume,
  saveResume,
  saveConfig,
  resetConfig,
  scan,
  setupStatus,
  suggestCompanies,
  syncDirectory,
  syncJobFeed,
  scanPlan,
  acquireScanLock,
  releaseScanLock,
  digest,
  finishedMessage,
  sendTelegram,
  telegramSecrets,
  saveTelegramSecrets,
  telegramBotName,
  findTelegramChat,
  looksLikeToken,
  maskToken,
  installSchedule,
  removeSchedule,
  runScheduleNow,
  scheduleStatus,
  recordScheduledRun,
  type MergeResult,
  type RunResult,
  type ScheduledRun,
  resumable,
  readDirectory,
  SCAN_SCOPES,
  personalConfigPath,
  isLegacyConfig,
  type BoardMove,
  type ScanScope,
  type DirectoryEntry,
  directoryAgeDays,
  directoryStatus,
  queueContributions,
  sendContributions,
  updateDirectory,
  companyWords,
  lookalikes,
  matchEmployers,
  ProfileSchema,
  rolesFromResume,
  seedFromRole,
  type CompanyCheck,
  type CompanyHealth,
  type CompanyShape,
  type Config,
  type Profile,
  type SuggestResult,
  type IndexedCompany,
  type Job,
} from "@rawjobs/core";
import { ATS_TYPES } from "@rawjobs/core";

/** A company's own hiring system, not a job board (JOB_BOARDS): boards are never shared or put in the directory. */
const isAts = (ats: string | undefined) => (ATS_TYPES as readonly string[]).includes(ats ?? "");

/** Remember boards found by "Add by link" that the directory doesn't have yet. */
function recordAdditions(dataDir: string, results: CompanyCheck[]): void {
  const fresh = results.filter((r) => (r.status === "live" || r.status === "dormant") && !r.in_directory && r.key && isAts(r.ats));
  if (!fresh.length) return;
  const file = resolve(dataDir, "catalog", "additions.json");
  const current = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { companies: (DirectoryEntry & { added_at: string })[] }).companies : [];
  const byKey = new Map(current.map((c) => [c.key, c]));
  for (const r of fresh) {
    byKey.set(r.key!, {
      key: r.key!,
      name: r.name!,
      ats: r.ats!,
      slug: r.slug!,
      ...(r.region ? { region: r.region } : {}),
      ...(r.shard ? { shard: r.shard } : {}),
      ...(r.site ? { site: r.site } : {}),
      careers_url: r.careers_url!,
      status: r.status,
      open_jobs: r.open_jobs ?? null,
      added_at: byKey.get(r.key!)?.added_at ?? new Date().toISOString(),
    });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ companies: [...byKey.values()] }, null, 1));
}

type SuggestInput = { profile?: unknown; watched?: string[]; hidden?: string[] };

/**
 * What the Companies page shows beyond the three lists: your past employers in the directory
 * ("go back?"), companies like them, one starter pack per industry you picked, and how much of
 * your industries we can track.
 */
function companyExtras(profile: Profile, pool: SuggestResult, indexed: readonly IndexedCompany[], directory: readonly DirectoryEntry[], exclude: ReadonlySet<string>) {
  const candidates = [...pool.hiringNow, ...pool.worthWatching];
  const rowsByKey = new Map(indexed.map((c) => [c.key, c]));
  const dirByKey = new Map(directory.map((c) => [c.key, c]));
  const source = (key: string) => rowsByKey.get(key) ?? dirByKey.get(key);
  const shapes = new Map<string, CompanyShape>();

  // Past employers: the confirmed list, or (until there is one) what the resume says.
  const roles = rolesFromResume(readResume().text ?? "");
  const names = profile.past_employers.length ? profile.past_employers : roles.map((r) => r.company);
  const matched = matchEmployers(names, directory);
  const roleOf = (name: string) => roles.find((r) => companyWords(r.company).join(" ") === companyWords(name).join(" "));
  const lookalikeRows = matched
    .map(({ name, match }) => {
      const role = roleOf(name);
      const seed = match ? { ...(rowsByKey.get(match.key) ?? match), name } : role ? seedFromRole(role) : undefined;
      return seed ? { seed: name, in_directory: !!match, items: lookalikes(seed, candidates, source, shapes, { limit: 6 }) } : undefined;
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.items.length > 0)
    .slice(0, 3);
  const pastEmployers = matched.map(({ name, match }) => ({
    name,
    ...(match && !exclude.has(match.key)
      ? {
          company: {
            key: match.key,
            name: match.name,
            ats: match.ats,
            slug: match.slug,
            careers_url: match.careers_url,
            region: match.region,
            shard: match.shard,
            site: match.site,
            open_jobs: match.open_jobs,
            status: match.status,
          },
        }
      : {}),
    watched: !!match && exclude.has(match.key),
  }));

  const wanted = new Set(profile.industries);
  const packs = profile.industries.map((id) => ({
    industry: id,
    items: candidates
      .filter((c) => c.industries.includes(id) && connectors[c.ats as keyof typeof connectors])
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
  }));
  const inIndustries = directory.filter((c) => c.tags?.some((t) => wanted.has(t)));
  const coverage = {
    in_industries: new Set(inIndustries.map((c) => companyWords(c.name).join(" "))).size,
    trackable: new Set(inIndustries.filter((c) => c.status === "live" && connectors[c.ats as keyof typeof connectors]).map((c) => companyWords(c.name).join(" "))).size,
  };
  return { pastEmployers, lookalikes: lookalikeRows, packs: packs.filter((p) => p.items.length), coverage };
}

async function cmdCompanies(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      data: { type: "string", short: "d", default: defaultDataDir() },
      limit: { type: "string", short: "n", default: "30" },
      json: { type: "boolean", default: false },
      stdin: { type: "boolean", default: false },
    },
  });
  if (positionals[0] !== "suggest") {
    console.error("Usage: rawjobs companies suggest [--json] [--limit n]");
    return 2;
  }
  const indexFile = resolve(values.data, "catalog", "index.json");
  if (!existsSync(indexFile)) {
    const msg = "No company index yet. Build it with: pnpm catalog:refresh";
    if (values.json) console.log(JSON.stringify({ error: msg, hiringNow: [], worthWatching: [], scanned: 0 }));
    else console.error(msg);
    return values.json ? 0 : 1;
  }
  // The dashboard sends the profile being edited (maybe not saved yet) and the companies to leave out.
  const input: SuggestInput = values.stdin ? (JSON.parse((await readStdin()) || "{}") as SuggestInput) : {};
  const sent = input.profile ? ProfileSchema.safeParse(input.profile) : undefined;
  let config: Config | undefined;
  try {
    config = loadConfig(values.config).config;
  } catch (err) {
    if (!sent?.success) throw err;
  }
  const profile = sent?.success ? sent.data : config!.profile;
  const index = JSON.parse(readFileSync(indexFile, "utf8")) as { generated_at: string; companies: IndexedCompany[] };
  const directory = readDirectory(values.data);
  // Directory companies without job rows (no openings, or not indexed): candidates to watch.
  const others = directory.filter((c) => !c.indexed);
  // Leave out companies already watched and ones the user said no to.
  const exclude = new Set([...(input.watched ?? config?.companies.map(companyKey) ?? []), ...(input.hidden ?? []), ...(config?.companies_muted ?? [])].map((k) => k.toLowerCase()));
  const started = Date.now();
  const limit = Number(values.limit) || 30;
  // A deep pool for lookalikes and packs; the lists shown are its first `limit` (same order).
  const pool = suggestCompanies(profile, index.companies, { exclude, others, limit: 400, indexGeneratedAt: new Date(index.generated_at) });
  const result = { hiringNow: pool.hiringNow.slice(0, limit), worthWatching: pool.worthWatching.slice(0, limit), notScannable: pool.notScannable.slice(0, limit), scanned: pool.scanned };
  const extra = companyExtras(profile, pool, index.companies, directory, exclude);
  if (values.json) {
    console.log(JSON.stringify({ ...result, ...extra, index_generated_at: index.generated_at, took_ms: Date.now() - started }));
    return 0;
  }
  console.log(`Scanned ${result.scanned} companies in ${Date.now() - started} ms (index from ${index.generated_at.slice(0, 10)}).\n`);
  console.log("Hiring for you now:");
  for (const s of result.hiringNow) console.log(`  ${String(s.score).padStart(3)}  ${s.name} (${s.ats}) · ${s.reasons.join(" · ")}\n        e.g. ${s.examples.join(" | ")}`);
  console.log("\nWorth watching:");
  for (const s of result.worthWatching) console.log(`  ${String(s.score).padStart(3)}  ${s.name} (${s.ats}) · ${s.reasons.join(" · ")}`);
  if (result.notScannable.length) {
    console.log("\nIn your industries, not scannable yet:");
    for (const s of result.notScannable) console.log(`       ${s.name} (${s.ats}) · ${s.reasons.join(" · ")}`);
  }
  return 0;
}

const HELP = `RawJobs: self-hosted job radar

Usage:
  rawjobs serve [--port <n>] [--open] [--log <file>]   Run the dashboard on http://127.0.0.1:4317
  rawjobs open                Open the dashboard (starting it if it isn't running)
  rawjobs update [--check] [--to <version>]   Install the newest version now (an installed copy)
  rawjobs uninstall [--keep-data|--delete-data]   Remove an installed copy (your data is kept unless you say)
  rawjobs scan [options]      Sync the directory, fetch your companies (and more, by scope) live, score them
  rawjobs schedule <status|install|remove>   Scan on a schedule on this computer (--time 08:00 [--time 20:00] [--scope mine|all], default mine)
  rawjobs alerts telegram <status|token|connect|test|on|off|forget>   Telegram alerts
  rawjobs detect <url>...     Turn careers URLs into config lines
  rawjobs validate            Check your config file
  rawjobs setup <status|save|check>   Used by the dashboard's setup wizard (JSON in/out)
  rawjobs companies suggest   Companies from the directory that fit your profile (industries, roles, places)
  rawjobs directory <status|update|share>   The shared company directory: download the latest, share additions

Options for companies suggest:
  -c, --config <path>   Config file (as for run)
  -d, --data <dir>      Where data/catalog/index.json lives (default: data)
  -n, --limit <n>       How many to suggest (default 30)
      --json            Print JSON (used by the dashboard)
      --stdin           Read {"profile"?, "watched"?: ["ats:slug"], "hidden"?: ["ats:slug"]} from stdin (the profile being edited, companies to leave out)

Options for scan (alias: run):
  -s, --scope <type>    mine: your companies + every directory company in your industries (default)
                        all:  your companies + every company in the directory (about 2 h)
      --offline         Don't sync the company directory first
      --full            Fetch every directory company live (don't let the shared job feed skip any)
      --fresh           Start over instead of resuming a stopped scan (Ctrl+C stops and saves progress)
      --plan            Print what each scope covers (companies, minutes) as JSON
      --notify          Send the new jobs to Telegram (when set up in Settings → Alerts)
  -c, --config <path>   Config file (default: rawjobs.config.local.yaml, then rawjobs.config.yaml)
  -o, --only <name>     Only this company (name or slug); repeatable
  -a, --all             Also list jobs that failed the title/location gates
  -n, --limit <n>       Max jobs to print (default 50)
  -d, --data <dir>      Where history is kept for the dashboard (default: data)
      --dry-run         Don't save anything
      --json <path>     Also write this run's raw result as JSON
      --progress ndjson Print one JSON line per event instead of the report (for the dashboard)
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
    case "scan":
      return cmdRun(rest);
    case "detect":
      return cmdDetect(rest);
    case "validate":
      return cmdValidate(rest);
    case "setup":
      return cmdSetup(rest);
    case "companies":
      return cmdCompanies(rest);
    case "directory":
      return cmdDirectory(rest);
    case "alerts":
      return cmdAlerts(rest);
    case "schedule":
      return cmdSchedule(rest);
    case "serve":
      // Loaded only when asked for, so other commands start as fast as before.
      return (await import("../../server/src/serve")).serve(rest);
    case "open":
      return (await import("../../server/src/desktop")).openDashboard(rest);
    case "uninstall":
      return (await import("../../server/src/desktop")).uninstall(rest);
    case "update":
      return (await import("../../server/src/desktop")).updateCommand(rest);
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      return 2;
  }
}

type RunValues = {
  config?: string;
  only?: string[];
  check?: string[];
  data: string;
  "dry-run": boolean;
  scope?: string;
  offline: boolean;
  fresh: boolean;
  full: boolean;
};

const parseScope = (v: string | undefined): ScanScope => {
  if (v === undefined || v === "mine" || v === "all") return v ?? "mine";
  throw new Error(`--scope must be "mine" (your companies + your industries) or "all" (every company in the directory), not "${v}".`);
};

/** Stop a scan from outside: Ctrl+C here, or the dashboard's Stop button (it creates this file). */
const stopFile = (dataDir: string) => resolve(dataDir, "scan-stop");
/** "Tell me on Telegram when this scan is done": the dashboard creates this file during a scan. */
const notifyFile = (dataDir: string) => resolve(dataDir, "scan-notify");
function stopSignal(dataDir: string): () => boolean {
  rmSync(stopFile(dataDir), { force: true });
  rmSync(notifyFile(dataDir), { force: true });
  let interrupted = false;
  process.once("SIGINT", () => {
    interrupted = true;
    console.error("\nStopping after the companies in progress… (progress is saved; run again to resume)");
  });
  return () => interrupted || existsSync(stopFile(dataDir));
}

/** Moved boards go into your personal config (the scan already fetched them on their new board). */
function saveMoves(config: Config, path: string, moves: BoardMove[]): string | undefined {
  if (!moves.length) return undefined;
  if (resolve(path) !== personalConfigPath()) return `Update ${path} by hand: ${moves.map((m) => `${m.name} is now ${m.to.ats}:${m.to.slug}`).join("; ")}`;
  const key = (c: { ats: string; slug: string }) => `${c.ats}:${c.slug}`.toLowerCase();
  const companies = config.companies.map((c) => {
    const m = moves.find((x) => key(x.from) === key(c));
    return m ? { ...m.to, enabled: c.enabled } : c;
  });
  const res = saveConfig({ ...config, companies });
  return res.ok ? undefined : res.errors;
}

const duration = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s / 60))} min` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

async function cmdRun(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: "string", short: "c" },
      only: { type: "string", short: "o", multiple: true },
      all: { type: "boolean", short: "a", default: false },
      limit: { type: "string", short: "n", default: "50" },
      json: { type: "string" },
      data: { type: "string", short: "d", default: defaultDataDir() },
      "dry-run": { type: "boolean", default: false },
      progress: { type: "string" },
      /** Check just this directory company now ("ats:slug"); repeatable. */
      check: { type: "string", multiple: true },
      scope: { type: "string", short: "s" },
      /** Skip the directory sync (no network for it). */
      offline: { type: "boolean", default: false },
      /** Fetch every directory company live, without the shared job feed choosing which. */
      full: { type: "boolean", default: false },
      /** Start over instead of resuming a stopped scan. */
      fresh: { type: "boolean", default: false },
      /** Print what each scope would cover, as JSON, and exit. */
      plan: { type: "boolean", default: false },
      /** Send the new matches to Telegram (when it's set up and on). */
      notify: { type: "boolean", default: false },
      /** Run by the computer's scheduler: logged in data/schedule-runs.json. */
      scheduled: { type: "boolean", default: false },
    },
  });
  if (values.plan) return printPlan(values);
  if (values.progress === "ndjson") return runNdjson(values);
  const scope = parseScope(values.scope);
  const { config, path } = loadConfig(values.config);
  const dataDir = resolve(values.data);
  console.error(`Config: ${path}`);

  const fullScan = !values.only?.length && !values.check?.length;
  const startedAt = new Date().toISOString();
  const log = (run: Omit<ScheduledRun, "startedAt" | "scope">) => values.scheduled && recordScheduledRun(dataDir, { startedAt, scope, finishedAt: new Date().toISOString(), ...run });
  if (!values["dry-run"] && !acquireScanLock(dataDir)) {
    console.error("Another scan is running in this data folder; not starting a second one.");
    log({ ok: false, error: "Another scan was already running." });
    return 0;
  }
  try {
    if (fullScan && !values.offline) {
      console.error("Syncing the company directory…");
      console.error(`  ${(await syncDirectory(dataDir)).message}`);
      if (!values.full) console.error(`  ${(await syncJobFeed(dataDir)).message}`);
    }

    const { result, merged, summary, checks, moves, stopped } = await scan(config, {
      dataDir,
      scope,
      only: values.only,
      checkKeys: values.check,
      dryRun: values["dry-run"],
      resume: !values.fresh,
      feed: !values.full,
      stopped: stopSignal(dataDir),
      onStart: (s) =>
        console.error(
          `Checking ${values.only?.length ? values.only.join(", ") : `${s.yours.length} of your companies`}${s.extra ? ` and ${s.extra.toLocaleString()} ${s.scope === "all" ? "more from the directory" : "in your industries"}` : ""}${s.resumed ? ` (resuming: ${s.resumed.toLocaleString()} done already)` : ""}${s.skippedByFeed ? ` (${s.skippedByFeed.toLocaleString()} skipped: nothing for you in the shared job feed)` : ""}, about ${duration(s.seconds)}...\n`,
        ),
      onCompanyDone: (h) => {
        // A whole-directory scan prints your companies, matches and failures, not 17,000 lines.
        if (checks_quiet(h)) return;
        console.error(`  ${h.ok ? "ok " : "ERR"} ${h.company.padEnd(24)} ${healthLine(h)}`);
      },
    });

    const min = config.profile.min_score;
    const shown = result.jobs.filter((j) => values.all || !j.why.gate).slice(0, Number.isFinite(Number(values.limit)) ? Number(values.limit) : 50);
    const matches = result.jobs.filter((j) => !j.why.gate);
    const fresh = matches.filter((j) => merged.newIds.has(j.id)).length;
    console.log(`\n${matches.length} jobs passed your title and location gates (${fresh} new); ${matches.filter((j) => j.score >= min).length} scored ${min}+ (alert threshold).`);
    if (checks.length) console.log(`Checked ${checks.length.toLocaleString()} directory companies besides yours.`);
    if (stopped) console.log("Stopped before the end. Run the same scan again to carry on where it stopped.");
    for (const m of moves) console.log(`${m.name} moved from ${m.from.ats}:${m.from.slug} to ${m.to.ats}:${m.to.slug}; your config is updated.`);
    const moveError = values["dry-run"] ? undefined : saveMoves(config, path, moves);
    if (moveError) console.error(moveError);
    console.log("");
    if (shown.length) printJobs(shown, min);

    const failed = result.health.filter((h) => !h.ok && !h.unsupported);
    if (failed.length) {
      console.log(`\n${failed.length} compan${failed.length === 1 ? "y" : "ies"} failed:`);
      for (const h of failed.slice(0, 50)) console.log(`  ${h.company} (${h.ats}:${h.slug}): ${h.error}`);
      if (failed.length > 50) console.log(`  …and ${failed.length - 50} more`);
    }

    if (summary) console.error(`\nSaved to ${dataDir} (${merged.jobs.length} jobs tracked, ${summary.closed} closed this run). Open the dashboard with: pnpm start`);

    if (values.json) {
      const out = resolve(values.json);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(result, null, 2));
      console.error(`\nWrote ${out}`);
    }

    const notified = values.notify && !values["dry-run"] ? await notifyScan(config, result, merged, scope) : undefined;
    if (notified)
      console.error(`Telegram: ${notified === "sent" ? "sent the new jobs" : notified === "nothing-new" ? "nothing new to send" : notified === "off" ? "not set up (Settings → Alerts)" : notified}`);
    log({ ok: true, matches: matches.length, newMatches: fresh, notified, stopped });
    return 0;
  } catch (err) {
    log({ ok: false, error: (err as Error).message });
    throw err;
  } finally {
    if (!values["dry-run"]) releaseScanLock(dataDir);
    rmSync(stopFile(dataDir), { force: true });
  }

  function checks_quiet(h: CompanyHealth): boolean {
    return config.companies.every((c) => c.slug !== h.slug || c.ats !== h.ats) && h.matches === 0 && (h.ok || !!h.unsupported);
  }
}

/** What each scan type would cover, for the dashboard's picker: companies and about how long. */
function printPlan(values: { config?: string; data: string }): number {
  const { config } = loadConfig(values.config);
  const dataDir = resolve(values.data);
  const plans = Object.fromEntries(
    SCAN_SCOPES.map((scope) => {
      const p = scanPlan(config, dataDir, scope);
      return [scope, { yours: p.yours.length, extra: p.extra.length, seconds: p.seconds, resumable: resumable(dataDir, scope) ?? null }];
    }),
  );
  console.log(JSON.stringify(plans));
  return 0;
}

const emit = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`);

/** Machine-readable scan for the dashboard: sync, start, one line per company (yours, plus matches and failures), done (or error). */
async function runNdjson(values: RunValues): Promise<number> {
  try {
    const scope = parseScope(values.scope);
    const { config, path } = loadConfig(values.config);
    const dataDir = resolve(values.data);
    const fullScan = !values.only?.length && !values.check?.length;
    if (!values["dry-run"] && !acquireScanLock(dataDir)) {
      emit({ type: "error", message: "A scheduled scan is running right now. Its results show up here when it's done." });
      return 0;
    }
    try {
      if (fullScan && !values.offline) {
        emit({ type: "sync" });
        emit({ type: "synced", ...(await syncDirectory(dataDir)), ...(values.full ? {} : { feed: (await syncJobFeed(dataDir)).message }) });
      }
      const yours = new Set(config.companies.map((c) => `${c.ats}:${c.slug}`));
      let done = 0;
      /** Companies done per hiring system, including ones a resumed scan already did. */
      let doneByAts: Record<string, number> = {};
      const { result, merged, summary, checks, moves, stopped } = await scan(config, {
        dataDir,
        scope,
        only: values.only,
        checkKeys: values.check,
        dryRun: values["dry-run"],
        resume: !values.fresh,
        feed: !values.full,
        stopped: stopSignal(dataDir),
        onStart: (s) => {
          done = s.resumed;
          doneByAts = { ...s.resumedByAts };
          emit({
            type: "start",
            companies: s.yours,
            total: s.total,
            extra: s.extra,
            resumed: s.resumed,
            scope: s.scope,
            seconds: s.seconds,
            skippedByFeed: s.skippedByFeed,
            byAts: s.byAts,
            doneByAts,
          });
        },
        onCompanyDone: (h) => {
          done++;
          doneByAts[h.ats] = (doneByAts[h.ats] ?? 0) + 1;
          // Every one of yours, and directory companies that matched or failed; the rest only as a count.
          if (yours.has(`${h.ats}:${h.slug}`) || h.matches > 0 || (!h.ok && !h.unsupported)) emit({ type: "company", done, doneByAts, ...h });
          else if (done % 25 === 0) emit({ type: "progress", done, ats: h.ats, doneByAts });
        },
      });
      const moveError = values["dry-run"] ? undefined : saveMoves(config, path, moves);
      const matches = result.jobs.filter((j) => !j.why.gate);
      emit({
        type: "done",
        jobsFound: result.jobs.length,
        matches: matches.length,
        strong: matches.filter((j) => j.score >= config.profile.min_score).length,
        newMatches: summary?.newMatches ?? matches.filter((j) => merged.newIds.has(j.id)).length,
        failed: result.health.filter((h) => !h.ok && !h.unsupported).length,
        checked: checks.length,
        stopped,
        moves: moves.map((m) => ({ name: m.name, from: `${m.from.ats}:${m.from.slug}`, to: `${m.to.ats}:${m.to.slug}` })),
        ...(moveError ? { moveError } : {}),
      });
      if (existsSync(notifyFile(dataDir))) {
        rmSync(notifyFile(dataDir), { force: true });
        emit({
          type: "notified",
          result: await notifyFinished(
            config,
            matches.length,
            matches.filter((j) => merged.newIds.has(j.id)),
            scope,
            { stopped, done: result.health.length, total: checks.length + config.companies.filter((c) => c.enabled).length },
          ),
        });
      }
      return 0;
    } finally {
      if (!values["dry-run"]) releaseScanLock(dataDir);
      rmSync(stopFile(dataDir), { force: true });
    }
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
    return 1;
  }
}

/** Send the scan's new matches (or, with only_new off, every strong one) to Telegram. Never throws. */
/** Your companies as Telegram messages match them: lowercase "ats:slug". */
const yourCompanies = (config: Config) => new Set(config.companies.map((c) => `${c.ats}:${c.slug}`.toLowerCase()));

async function notifyScan(config: Config, result: RunResult, merged: MergeResult, scope: ScanScope): Promise<string> {
  const secrets = telegramSecrets();
  if (!config.alerts.telegram || !secrets.token || !secrets.chatId) return "off";
  const matches = result.jobs.filter((j) => !j.why.gate);
  const jobs = config.alerts.only_new ? matches.filter((j) => merged.newIds.has(j.id)) : matches.filter((j) => j.score >= config.profile.min_score);
  const text = digest(jobs, { minScore: config.profile.min_score, scopeLabel: scope === "all" ? "All companies" : "My companies + my industries", yours: yourCompanies(config) });
  if (!text) return "nothing-new";
  try {
    await sendTelegram(text, secrets);
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

/** "Tell me when it's done": sent whether or not there's anything new, and whatever the alerts switch says. */
async function notifyFinished(config: Config, matches: number, newJobs: Job[], scope: ScanScope, o: { stopped: boolean; done: number; total: number }): Promise<string> {
  const secrets = telegramSecrets();
  if (!secrets.token || !secrets.chatId) return "off";
  try {
    await sendTelegram(
      finishedMessage({ scopeLabel: scope === "all" ? "All companies" : "My companies + my industries", matches, newJobs, minScore: config.profile.min_score, yours: yourCompanies(config), ...o }),
      secrets,
    );
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

/** Telegram alerts (JSON in and out, for the dashboard): status, token, connect, test, off. */
async function cmdAlerts(args: string[]): Promise<number> {
  const [channel, action = "status"] = args;
  const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
  if (channel !== "telegram") {
    console.error("Usage: rawjobs alerts telegram <status|token|connect|test|off>");
    return 2;
  }
  const setEnabled = (on: boolean) => {
    const { config, path } = loadConfig();
    if (resolve(path) !== personalConfigPath()) return;
    if (config.alerts.telegram !== on) saveConfig({ ...config, alerts: { ...config.alerts, telegram: on } });
  };
  try {
    const secrets = telegramSecrets();
    if (action === "status") {
      let enabled = false;
      try {
        enabled = loadConfig().config.alerts.telegram;
      } catch {
        // no config yet
      }
      out({ ok: true, token: maskToken(secrets.token) ?? null, bot: secrets.bot ?? null, connected: !!secrets.chatId, enabled, fromEnv: !!process.env.TELEGRAM_BOT_TOKEN });
      return 0;
    }
    if (action === "token") {
      const token = String((JSON.parse((await readStdin()) || "{}") as { token?: unknown }).token ?? "").trim();
      if (!looksLikeToken(token)) {
        out({ ok: false, error: "That doesn't look like a bot token. It looks like 123456789:AAF… and comes from @BotFather." });
        return 0;
      }
      const bot = await telegramBotName(token);
      saveTelegramSecrets({ token, chatId: "", bot });
      out({ ok: true, bot });
      return 0;
    }
    if (!secrets.token) {
      out({ ok: false, error: "Add your bot token first." });
      return 0;
    }
    if (action === "connect") {
      const chat = await findTelegramChat(secrets.token);
      if (!chat) {
        out({ ok: false, error: 'No message from you yet. Open your bot in Telegram, press Start (or send it "hi"), then try again.' });
        return 0;
      }
      saveTelegramSecrets({ chatId: chat.chatId });
      setEnabled(true);
      await sendTelegram("✅ RawJobs is connected. New jobs from your scans will arrive here.", { ...secrets, chatId: chat.chatId });
      out({ ok: true, name: chat.name });
      return 0;
    }
    if (action === "test") {
      await sendTelegram("👋 Test from RawJobs. Alerts are working.", secrets);
      out({ ok: true });
      return 0;
    }
    if (action === "on" || action === "off") {
      setEnabled(action === "on");
      out({ ok: true });
      return 0;
    }
    if (action === "forget") {
      saveTelegramSecrets({ token: "", chatId: "", bot: "" });
      setEnabled(false);
      out({ ok: true });
      return 0;
    }
    out({ ok: false, error: `Unknown action "${action}".` });
    return 2;
  } catch (err) {
    out({ ok: false, error: (err as Error).message });
    return 0;
  }
}

/** Scheduled scans on this computer (JSON out): status, install --time hh:mm [--time …] [--scope mine|all], remove. */
async function cmdSchedule(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      time: { type: "string", multiple: true },
      scope: { type: "string" },
      data: { type: "string", short: "d", default: defaultDataDir() },
      stdin: { type: "boolean", default: false },
    },
  });
  const ctx = { repoRoot: CODE_ROOT, workDir: rawjobsHome(), launch: schedulerCommand(), dataDir: resolve(values.data) };
  const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
  try {
    const action = positionals[0] ?? "status";
    if (action === "install") {
      // From the terminal the scope defaults to mine, as for scan; the dashboard (--stdin) always sends one.
      const input = values.stdin ? (JSON.parse((await readStdin()) || "{}") as { times?: string[]; scope?: string }) : { times: values.time, scope: parseScope(values.scope) };
      installSchedule(ctx, { times: input.times, scope: input.scope as ScanScope });
    } else if (action === "remove") removeSchedule(ctx);
    else if (action === "run") runScheduleNow(ctx);
    else if (action !== "status") {
      out({ ok: false, error: "Usage: rawjobs schedule <status|install|remove|run>" });
      return 2;
    }
    out({ ok: true, ...scheduleStatus(ctx) });
    return 0;
  } catch (err) {
    out({ ok: false, error: (err as Error).message, ...scheduleStatus(ctx) });
    return 0;
  }
}

function readStdin(): Promise<string> {
  return new Promise((done, fail) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (text += d));
    process.stdin.on("end", () => done(text));
    process.stdin.on("error", fail);
  });
}

/** The shared company directory: status, download the latest copy, share waiting additions. */
async function cmdDirectory(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string", short: "d", default: defaultDataDir() },
      json: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "if-older": { type: "string" },
      /** Background update: skipped when auto_update is off in your settings. */
      auto: { type: "boolean", default: false },
    },
  });
  const dataDir = resolve(values.data);
  const out = (o: object, text: string) => console.log(values.json ? JSON.stringify(o) : text);
  /** Board sharing (on by default); when off, anything still waiting is dropped, not sent. */
  const sharing = () => {
    try {
      return loadConfig().config.directory.share_additions !== false;
    } catch {
      return true;
    }
  };
  switch (positionals[0] ?? "status") {
    case "status": {
      const s = directoryStatus(dataDir);
      const age = directoryAgeDays(dataDir);
      out(
        { ...s, age_days: Number.isFinite(age) ? Math.round(age * 10) / 10 : null, industries: directoryIndustryCounts(dataDir) },
        s.local
          ? `Shared directory ${s.local.version}: ${s.local.companies.toLocaleString()} companies, downloaded ${Math.round(age)} day(s) ago.`
          : s.present
            ? "Using a directory built on this computer (not downloaded)."
            : "No company directory yet. Run: pnpm rawjobs directory update",
      );
      return 0;
    }
    case "update": {
      if (values.auto) {
        const autoOn = (() => {
          try {
            return loadConfig().config.directory.auto_update;
          } catch {
            return true;
          }
        })();
        if (!autoOn) {
          out({ updated: false, message: "Automatic updates are off." }, "Automatic updates are off in your settings.");
          return 0;
        }
      }
      const olderThan = values["if-older"] ? Number(values["if-older"]) : undefined;
      if (olderThan !== undefined && directoryAgeDays(dataDir) < olderThan) {
        out({ updated: false, message: "Recent enough." }, "Directory is recent enough.");
        return 0;
      }
      const shared = await sendContributions(dataDir, { enabled: sharing() });
      const result = await updateDirectory(dataDir, { force: values.force }).catch((err: Error) => ({ updated: false, message: `Update failed: ${err.message}` }));
      out({ ...result, shared: shared.sent }, `${result.message}${shared.sent ? ` ${shared.message}` : ""}`);
      return 0;
    }
    case "share": {
      const result = await sendContributions(dataDir, { enabled: sharing() });
      out(result, result.message);
      return 0;
    }
    default:
      console.error("Usage: rawjobs directory <status|update|share> [--force] [--if-older <days>] [--json]");
      return 2;
  }
}

/** JSON in (stdin) / JSON out (stdout), for the dashboard's local setup API. */
async function cmdSetup(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { data: { type: "string", short: "d", default: defaultDataDir() } } });
  switch (positionals[0]) {
    case "status":
      console.log(JSON.stringify(setupStatus(rawjobsHome(), resolve(values.data))));
      return 0;
    case "save": {
      const result = saveConfig(JSON.parse(await readStdin()));
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }
    case "reset":
      console.log(JSON.stringify(resetConfig()));
      return 0;
    case "resume": {
      if (positionals[1] === "delete") {
        console.log(JSON.stringify(deleteResume()));
        return 0;
      }
      if (positionals[1] === "save") {
        const body = JSON.parse(await readStdin()) as { text?: string };
        const result = saveResume(body.text ?? "");
        console.log(JSON.stringify(result));
        return result.ok ? 0 : 1;
      }
      console.log(JSON.stringify(readResume()));
      return 0;
    }
    case "check": {
      const body = JSON.parse(await readStdin()) as { urls?: string[] };
      // Your saved profile (to count matching jobs) and the directory (to mark known companies).
      const status = setupStatus(rawjobsHome(), resolve(values.data));
      const directory = new Map(readDirectory(values.data).map((c) => [c.key, c]));
      const results = await checkCompanies(body.urls ?? [], { profile: status.config?.profile, directory });
      recordAdditions(values.data, results);
      // Share new boards with the directory (unless turned off in settings). Best effort: the
      // outbox keeps anything that couldn't be sent, and the next update retries it.
      if (status.config?.directory.share_additions !== false) {
        const fresh = results.filter((r) => (r.status === "live" || r.status === "dormant") && !r.in_directory && isAts(r.ats) && r.slug);
        if (fresh.length) {
          queueContributions(
            values.data,
            fresh.map((r) => ({
              ats: r.ats!,
              slug: r.slug!,
              ...(r.region === "eu" ? { region: "eu" } : {}),
              ...(r.shard ? { shard: r.shard } : {}),
              ...(r.site ? { site: r.site } : {}),
              ...(r.name ? { name: r.name } : {}),
            })),
          );
          await sendContributions(values.data);
        }
      }
      console.log(JSON.stringify(results));
      return 0;
    }
    default:
      console.error("Usage: rawjobs setup <status|save|check|resume [save]>");
      return 2;
  }
}

function healthLine(h: CompanyHealth): string {
  if (!h.ok) return h.error ?? "failed";
  return `${String(h.jobsFound).padStart(4)} jobs, ${h.matches} match${h.matches === 1 ? "" : "es"} (${(h.durationMs / 1000).toFixed(1)}s)`;
}

function printJobs(jobs: Job[], min: number): void {
  for (const j of jobs) {
    const mark = j.score >= min ? "★" : " ";
    const why = j.why.gate
      ? `failed ${j.why.gate} gate`
      : `title ${j.why.title} · place ${j.why.location} · keywords ${j.why.keywordPoints}${j.why.keywords.length ? ` (${j.why.keywords.join(", ")})` : ""} · industry ${j.why.industry ?? "?"}`;
    const posted = j.postedAt ? j.postedAt.slice(0, 10) : "—";
    console.log(`${mark} ${String(j.score).padStart(3)}  ${j.title}`);
    console.log(`        ${j.company} · ${j.location || "location n/a"} · ${j.workplace} · posted ${posted}`);
    console.log(`        ${why}`);
    console.log(`        ${j.url}\n`);
  }
}

function cmdDetect(urls: string[]): number {
  if (!urls.length) {
    console.error("Usage: rawjobs detect <careers-url> [more urls...]");
    return 2;
  }
  let failures = 0;
  for (const u of urls) {
    const c = detectCompany(u);
    if (!c) {
      console.error(`# could not detect an ATS for ${u} (supported so far: ${Object.keys(connectors).join(", ")})`);
      failures++;
      continue;
    }
    if (!c.supported) console.error(`# ${c.ats} is recognised but not fetched yet; this line will start working when its connector ships`);
    const extra = [c.region && `region: ${c.region}`, c.shard && `shard: "${c.shard}"`, c.site && `site: "${c.site}"`]
      .filter(Boolean)
      .map((s) => `, ${s}`)
      .join("");
    console.log(`  - { name: "${c.name}", ats: ${c.ats}, slug: "${c.slug}"${extra} }`);
  }
  return failures ? 1 : 0;
}

function cmdValidate(args: string[]): number {
  const { values } = parseArgs({ args, options: { config: { type: "string", short: "c" } } });
  const { config, path } = loadConfig(values.config);
  const byAts = new Map<string, number>();
  for (const c of config.companies) byAts.set(c.ats, (byAts.get(c.ats) ?? 0) + 1);
  const unsupported = config.companies.filter((c) => !connectors[c.ats]);
  console.log(`✓ ${path} is valid`);
  if (isLegacyConfig(path)) console.log(`  note: rename it to ${path.replace("jobhunter.config", "rawjobs.config")}; the old name still works for now`);
  console.log(`  profile: ${config.profile.name}, min_score ${config.profile.min_score}, ${Object.keys(config.profile.keywords).length} keywords`);
  console.log(`  companies: ${config.companies.length} (${[...byAts].map(([a, n]) => `${a} ${n}`).join(", ")})`);
  if (unsupported.length) {
    console.log(`  note: no connector yet for ${unsupported.map((c) => `${c.name} (${c.ats})`).join(", ")}; they're kept and will start working when support ships`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof ConfigError || (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error((err as Error).message);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  },
);
