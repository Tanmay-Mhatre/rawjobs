import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  defaultDataDir,
  readDirectory,
  loadConfig,
  scan,
  syncDirectory,
  syncJobFeed,
  scanPlan,
  acquireScanLock,
  releaseScanLock,
  alertJobs,
  digest,
  availableJobs,
  finishedMessage,
  sendTelegram,
  telegramSecrets,
  remindFollowUps,
  remindDeadlines,
  remindInterviews,
  sendWeeklySummary,
  recordScheduledRun,
  type MergeResult,
  type RunResult,
  type ScheduledRun,
  resumable,
  SCAN_SCOPES,
  type ScanScope,
  type CompanyHealth,
  type Config,
  type Job,
  type ScanStats,
  toDashboardJob,
  sourceCounts,
  type AlertScope,
  type ScanOptions,
  type ScanResult,
} from "@rawjobs/core";
import type { ScanSource } from "@rawjobs/core/protocol";
import type { RunEvent } from "@rawjobs/core/protocol";

export type RunValues = {
  config?: string;
  only?: string[];
  check?: string[];
  data: string;
  "dry-run": boolean;
  scope?: string;
  offline: boolean;
  fresh: boolean;
  full: boolean;
  /** Skip the background check of every other company after a "mine" scan. */
  "no-background"?: boolean;
  /** Only the background check, carrying on a paused one (the dashboard's Resume now). */
  "background-only"?: boolean;
};

export const parseScope = (v: string | undefined): ScanScope => {
  if (v === undefined || v === "mine" || v === "all" || v === "yours") return v ?? "mine";
  throw new Error(`--scope must be "mine" (your companies, past matches and the job feed's picks), "yours" (only your companies) or "all" (every company in the directory), not "${v}".`);
};

/** Stop a scan from outside: Ctrl+C here, or the dashboard's Stop button (it creates this file). */
export const stopFile = (dataDir: string) => resolve(dataDir, "scan-stop");
/** "Tell me on Telegram when this scan is done": the dashboard creates this file during a scan. */
export const notifyFile = (dataDir: string) => resolve(dataDir, "scan-notify");
export function stopSignal(dataDir: string): () => boolean {
  rmSync(stopFile(dataDir), { force: true });
  rmSync(notifyFile(dataDir), { force: true });
  let interrupted = false;
  process.once("SIGINT", () => {
    interrupted = true;
    console.error("\nStopping… (progress is saved; run again to resume)");
  });
  return () => interrupted || existsSync(stopFile(dataDir));
}

/**
 * After Scan now ("mine", run to the end, not a fallback that checked every company already): the
 * quiet check of every other company, when it's on (Settings > Scans).
 */
export function wantsBackground(config: Config, values: RunValues, scope: ScanScope, stage1: { stopped: boolean; fallback?: boolean }): boolean {
  return scope === "mine" && config.scans.background && !values["no-background"] && !values["dry-run"] && !values.only?.length && !values.check?.length && !stage1.stopped && !stage1.fallback;
}

/** The background check: every company Scan now didn't just fetch (`since`: when it started), live, resumable. */
export const backgroundCheck = (config: Config, base: ScanOptions & { stopped: () => boolean }, since: number): Promise<ScanResult> =>
  scan(config, { ...base, scope: "all", feed: false, resume: true, skipFetchedSince: since });

/** The background check's alert: only jobs new to you (never ones already sent), whatever "only new" says. */
const newOnly = (config: Config): Config => ({ ...config, alerts: { ...config.alerts, only_new: true } });

export const duration = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s / 60))} min` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

/** The scan options both runners (the report and the dashboard's NDJSON) share. */
export function sessionOptions(values: RunValues, dataDir: string, scope: ScanScope) {
  return {
    dataDir,
    scope,
    only: values.only,
    checkKeys: values.check,
    dryRun: values["dry-run"],
    resume: !values.fresh,
    feed: !values.full,
    stopped: stopSignal(dataDir),
  };
}

/**
 * Run a scan holding the data folder's scan lock (not for a dry run): the directory and job feed
 * sync first on a full scan that's online, then `body`. The lock and the stop file are released
 * however it ends. When another scan holds the lock, `busy()` answers instead.
 */
export async function scanSession<T>(values: RunValues, dataDir: string, o: { busy: () => T; sync: () => Promise<void> }, body: (syncMs: number) => Promise<T>): Promise<T> {
  if (!values["dry-run"] && !acquireScanLock(dataDir)) return o.busy();
  try {
    const fullScan = !values.only?.length && !values.check?.length;
    const started = Date.now();
    if (fullScan && !values.offline) await o.sync();
    return await body(Date.now() - started);
  } finally {
    if (!values["dry-run"]) releaseScanLock(dataDir);
    rmSync(stopFile(dataDir), { force: true });
  }
}

export async function cmdRun(args: string[]): Promise<number> {
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
      /** After a "mine" scan, don't run the background check of every other company. */
      "no-background": { type: "boolean", default: false },
      /** Only the background check, carrying on a paused one (with --progress ndjson). */
      "background-only": { type: "boolean", default: false },
    },
  });
  if (values.plan) return printPlan(values);
  lowerPriority();
  if (values.progress === "ndjson") return runNdjson(values);
  const scope = parseScope(values.scope);
  const { config, path } = loadConfig(values.config);
  const dataDir = resolve(values.data);
  console.error(`Config: ${path}`);

  const startedAt = new Date().toISOString();
  const log = (run: Omit<ScheduledRun, "startedAt" | "scope">) => values.scheduled && recordScheduledRun(dataDir, { startedAt, scope, finishedAt: new Date().toISOString(), ...run });
  const busy = () => {
    console.error("Another scan is running in this data folder; not starting a second one.");
    log({ ok: false, error: "Another scan was already running." });
    return 0;
  };
  const sync = async () => {
    console.error("Syncing the company directory…");
    console.error(`  ${(await syncDirectory(dataDir)).message}`);
    if (!values.full) console.error(`  ${(await syncJobFeed(dataDir)).message}`);
  };
  try {
    return await scanSession(values, dataDir, { busy, sync }, async (syncMs) => {
      const stage1Started = Date.now();
      let fallback = false;
      const session = sessionOptions(values, dataDir, scope);
      const { result, merged, summary, checks, moves, stopped, resting, quiet, chronic, openCheck, stats } = await scan(config, {
        ...session,
        syncMs,
        // Only when an alert will go out: the check costs requests the alert-less scan doesn't need.
        checkBeforeAlert: values.notify && alertsOn(config),
        onStart: (s) => {
          fallback = !!s.fallback;
          if (s.fallback) console.error(`The shared job feed is ${s.feedAgeDays === undefined ? "missing" : `${Math.floor(s.feedAgeDays)} days old`}, so this scan checks every company itself.`);
          console.error(
            `Checking ${values.only?.length ? values.only.join(", ") : `${s.yours.length} of your companies`}${s.extra ? ` and ${s.extra.toLocaleString()} ${s.scope === "all" || s.fallback ? "more from the directory" : "past matches and job-feed picks"}` : ""}${s.resumed ? ` (resuming: ${s.resumed.toLocaleString()} done already)` : ""}${s.skippedByFeed ? ` (${s.skippedByFeed.toLocaleString()} skipped: nothing for you in the shared job feed)` : ""}${s.resting ? ` (${s.resting.toLocaleString()} resting after failing)` : ""}${s.quiet ? ` (${s.quiet.toLocaleString()} quiet: unchanged for weeks)` : ""}, about ${duration(s.seconds)}...\n`,
          );
        },
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
      for (const m of moves) console.log(`${m.name}'s careers page is gone. It may have moved to ${m.to.ats}:${m.to.slug}: check it's the same company, then update its link in My companies.`);
      console.log("");
      if (shown.length) printJobs(shown, min);

      const failed = result.health.filter((h) => !h.ok && !h.unsupported);
      if (failed.length) {
        console.log(`\n${failed.length} compan${failed.length === 1 ? "y" : "ies"} failed:`);
        for (const h of failed.slice(0, 50)) console.log(`  ${h.company} (${h.ats}:${h.slug}): ${h.error}`);
        if (failed.length > 50) console.log(`  …and ${failed.length - 50} more`);
      }
      if (resting)
        console.log(
          `\n${resting.toLocaleString()} directory board${resting === 1 ? "" : "s"} left alone this scan: failed last time, tried again after a rest (up to a day; your companies are always checked).`,
        );
      if (quiet)
        console.log(
          `${resting ? "" : "\n"}${quiet.toLocaleString()} quiet directory board${quiet === 1 ? "" : "s"} left alone: no jobs added or removed for 2 weeks or more, checked once a day (every 3 days after 45 days).`,
        );
      if (chronic.length) {
        console.log(`\n${chronic.length} board${chronic.length === 1 ? " hasn't" : "s haven't"} worked for 30 days or more (directory boards are tried once a day now):`);
        for (const name of chronic.slice(0, 20)) console.log(`  ${name}`);
        if (chronic.length > 20) console.log(`  …and ${chronic.length - 20} more`);
      }

      if (openCheck?.checked)
        console.error(
          `\nChecked ${openCheck.checked} job${openCheck.checked === 1 ? "" : "s"} again before alerting: ${openCheck.closed ? `${openCheck.closed} had closed (marked closed, left out of the alert)` : "all still open"}.`,
        );
      console.error(`\n${statsLine(stats)}`);
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
      // Jobs you applied to that are due a follow-up ride along with the scan's alerts.
      if (values.notify && !values["dry-run"] && alertsOn(config)) {
        const followUps = await remindFollowUps(dataDir, telegramSecrets());
        if (followUps !== "nothing-due") console.error(`Telegram: ${followUps === "sent" ? "sent a follow-up reminder" : followUps}`);
        const interviews = await remindInterviews(dataDir, telegramSecrets());
        if (interviews !== "nothing-due") console.error(`Telegram: ${interviews === "sent" ? "sent an interview reminder" : interviews}`);
        const deadlines = await remindDeadlines(dataDir, telegramSecrets());
        if (deadlines !== "nothing-due") console.error(`Telegram: ${deadlines === "sent" ? "sent an offer-deadline reminder" : deadlines}`);
        const weekly = await sendWeeklySummary(dataDir, telegramSecrets());
        if (weekly === "sent" || weekly.startsWith("failed")) console.error(`Telegram: ${weekly === "sent" ? "sent the weekly summary" : weekly}`);
      }
      let newMatches = fresh;
      if (wantsBackground(config, values, scope, { stopped, fallback })) {
        const bg = await backgroundCheck(config, session, stage1Started);
        const found = bg.result.jobs.filter((j) => !j.why.gate && bg.merged.newIds.has(j.id)).length;
        newMatches += found;
        console.log(
          `\nBackground check: ${bg.checks.length.toLocaleString()} more companies, ${found} new match${found === 1 ? "" : "es"}${bg.stopped ? " (stopped; the next one carries on where it stopped)" : ""}.`,
        );
        if (values.notify && found) await notifyScan(newOnly(config), bg.result, bg.merged, "background");
      }
      log({ ok: true, matches: matches.length, newMatches, notified, stopped });
      return 0;
    });
  } catch (err) {
    log({ ok: false, error: (err as Error).message });
    throw err;
  }

  function checks_quiet(h: CompanyHealth): boolean {
    return config.companies.every((c) => c.slug !== h.slug || c.ats !== h.ats) && h.matches === 0 && (h.ok || !!h.unsupported);
  }
}

/** What each scan type would cover, for the dashboard's picker: companies and about how long. */
export function printPlan(values: { config?: string; data: string }): number {
  const { config } = loadConfig(values.config);
  const dataDir = resolve(values.data);
  const directory = readDirectory(dataDir);
  const plans = Object.fromEntries(
    SCAN_SCOPES.map((scope) => {
      const p = scanPlan(config, dataDir, scope, directory);
      return [scope, { yours: p.yours.length, extra: p.extra.length, seconds: p.seconds, stages: p.stages, fallback: p.fallback, resumable: resumable(dataDir, scope) ?? null }];
    }),
  );
  console.log(JSON.stringify(plans));
  return 0;
}

/** One line of the dashboard's scan progress: @rawjobs/core/protocol's RunEvent. */
export const emit = (event: RunEvent) => process.stdout.write(`${JSON.stringify(event)}\n`);

/** Machine-readable scan for the dashboard: sync, start, one line per company (yours, plus matches and failures), done (or error). */
export async function runNdjson(values: RunValues): Promise<number> {
  try {
    const scope = parseScope(values.scope);
    const { config } = loadConfig(values.config);
    const dataDir = resolve(values.data);
    const busy = () => {
      emit({ type: "error", message: "A scheduled scan is running right now. Its results show up here when it's done." });
      return 0;
    };
    const sync = async () => {
      // Resume now carries on the background check: the directory was synced when it began.
      if (values["background-only"]) return;
      emit({ type: "sync" });
      emit({ type: "synced", ...(await syncDirectory(dataDir)), ...(values.full ? {} : { feed: (await syncJobFeed(dataDir)).message }) });
    };
    return await scanSession(values, dataDir, { busy, sync }, async (syncMs) => {
      const yours = new Set(config.companies.map((c) => `${c.ats}:${c.slug}`));
      const session = sessionOptions(values, dataDir, scope);
      const stage1Started = Date.now();
      let fallback = false;
      /** One stage's progress lines: start, a line per company (or a count), its matches as they come. */
      const hooks = (stage: "quick" | "background"): Pick<ScanOptions, "onStart" | "onCompanyDone" | "onCompanyResult"> => {
        let done = 0;
        /** When the last progress line went out. */
        let lastLine = 0;
        /** Companies done per hiring system, including ones a resumed scan already did. */
        let doneByAts: Record<string, number> = {};
        /** Scan now's companies by where they come from (yours, past matches, feed picks), and how many are done. */
        let sourceOf = new Map<string, ScanSource>();
        let doneBySource: Record<ScanSource, number> | undefined;
        return {
          onStart: (s) => {
            done = s.resumed;
            doneByAts = { ...s.resumedByAts };
            if (stage === "quick") fallback = !!s.fallback;
            if (s.sources) {
              sourceOf = new Map(Object.entries(s.sources));
              doneBySource = sourceCounts();
            }
            const bySource = s.sources ? sourceCounts() : undefined;
            if (bySource) {
              bySource.yours = s.yours.length;
              for (const src of sourceOf.values()) bySource[src]++;
            }
            emit({
              type: "start",
              companies: s.yours,
              total: s.total,
              extra: s.extra,
              resumed: s.resumed,
              scope: s.scope,
              stage,
              seconds: s.seconds,
              stages: s.stages,
              skippedByFeed: s.skippedByFeed,
              byAts: s.byAts,
              doneByAts,
              ...(bySource ? { bySource, doneBySource } : {}),
              ...(s.fallback ? { fallback: true } : {}),
              feedAgeDays: s.feedAgeDays ?? null,
            });
          },
          onCompanyDone: (h) => {
            done++;
            doneByAts[h.ats] = (doneByAts[h.ats] ?? 0) + 1;
            const mine = yours.has(`${h.ats}:${h.slug}`);
            if (doneBySource) {
              const src = mine ? "yours" : sourceOf.get(h.key ?? "");
              if (src) doneBySource[src]++;
            }
            const counts = { doneByAts, ...(doneBySource ? { doneBySource } : {}) };
            // Every one of yours, and directory companies that matched or failed; the rest only as a count
            // (every 25, or after 2 s without a line, so a slow stretch still shows it's moving).
            if (mine || h.matches > 0 || (!h.ok && !h.unsupported)) emit({ type: "company", done, ...counts, ...h });
            else if (done % 25 === 0 || Date.now() - lastLine > 2000) emit({ type: "progress", done, ats: h.ats, last: h.company, ...counts });
            else return;
            lastLine = Date.now();
          },
          // Matches as each company finishes, so the Radar shows them before the scan ends.
          onCompanyResult: (_h, jobs) => {
            const matches = jobs.filter((j) => !j.why.gate);
            if (matches.length) emit({ type: "jobs", jobs: matches.map(toDashboardJob) });
          },
        };
      };
      const doneEvent = (r: ScanResult, stage: "quick" | "background") => {
        const matches = r.result.jobs.filter((j) => !j.why.gate);
        const newMatches = r.summary?.newMatches ?? matches.filter((j) => r.merged.newIds.has(j.id)).length;
        emit({
          type: "done",
          stage,
          jobsFound: r.result.jobs.length,
          matches: matches.length,
          strong: matches.filter((j) => j.score >= config.profile.min_score).length,
          newMatches,
          failed: r.result.health.filter((h) => !h.ok && !h.unsupported).length,
          checked: r.checks.length,
          stopped: r.stopped,
          ...(r.result.everyCompany ? { everyCompany: true } : {}),
          moves: r.moves.map((m) => ({ name: m.name, from: `${m.from.ats}:${m.from.slug}`, to: `${m.to.ats}:${m.to.slug}` })),
          stats: {
            stages: r.stats.stages,
            wallMs: r.stats.wallMs,
            requests: r.stats.http.requests,
            notModified: r.stats.http.notModified,
            rateLimited: r.stats.http.rateLimited,
            timeouts: r.stats.http.timeouts,
          },
        });
        return { matches, newMatches };
      };

      /** The background check: its progress lines, but not its matches (it's quiet: they show when it ends). */
      const background = async (since: number) => {
        emit({ type: "background" });
        const { onCompanyResult: _, ...bgHooks } = hooks("background");
        const bg = await backgroundCheck(config, { ...session, ...bgHooks }, since);
        const { newMatches } = doneEvent(bg, "background");
        // Quiet: a Telegram message only when it found something new (and never a job already sent).
        if (newMatches && alertsOn(config)) await notifyScan(newOnly(config), bg.result, bg.merged, "background");
      };
      if (values["background-only"]) {
        // Resume now: skip what the paused check (or the Scan now before it) fetched in the hour before it began.
        const paused = resumable(dataDir, "all");
        await background((paused ? Date.parse(paused.startedAt) : Date.now()) - 3_600_000);
        return 0;
      }

      const first = await scan(config, { ...session, syncMs, ...hooks("quick") });
      doneEvent(first, "quick");
      if (existsSync(notifyFile(dataDir))) {
        rmSync(notifyFile(dataDir), { force: true });
        emit({
          type: "notified",
          result: await notifyFinished(availableJobs(first.merged.jobs).length, first.stopped, scope),
        });
      }
      if (wantsBackground(config, values, scope, { stopped: first.stopped, fallback })) await background(stage1Started);
      return 0;
    });
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
    return 1;
  }
}

/** Telegram alerts are switched on and the bot is set up. */
function alertsOn(config: Config): boolean {
  const secrets = telegramSecrets();
  return !!(config.alerts.telegram && secrets.token && secrets.chatId);
}

/** Send how many new matches the scan found (or, with only_new off, how many strong ones) to Telegram. Never throws. */
export async function notifyScan(config: Config, result: RunResult, merged: MergeResult, scope: AlertScope): Promise<string> {
  const secrets = telegramSecrets();
  if (!alertsOn(config)) return "off";
  const jobs = alertJobs(config, result.jobs, merged.newIds);
  const text = digest(jobs, { minScore: config.profile.min_score, onlyNew: config.alerts.only_new, scope });
  if (!text) return "nothing-new";
  try {
    await sendTelegram(text, secrets);
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

/** "Tell me when it's done": sent whether or not there's anything new, and whatever the alerts switch says. */
export async function notifyFinished(available: number, stopped: boolean, scope: ScanScope): Promise<string> {
  const secrets = telegramSecrets();
  if (!secrets.token || !secrets.chatId) return "off";
  try {
    await sendTelegram(finishedMessage({ available, stopped, scope }), secrets);
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

/** A scan runs below normal priority (whoever started it), so the computer stays quick to use meanwhile. */
function lowerPriority(): void {
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not allowed here: the scan just runs at normal priority.
  }
}

/** "Took 4.2 min: sync 9s · feed match 12s · live 3.9 min · save 2s. 1,204 requests: 310 unchanged, 0 rate-limited, 3 timed out." */
export function statsLine(s: ScanStats): string {
  const t = (ms: number) => (ms >= 90_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.round(ms / 1000)}s`);
  const { sync, match, live, save } = s.stages;
  const h = s.http;
  return `Took ${t(s.wallMs)}: sync ${t(sync)} · feed match ${t(match)} · live ${t(live)} · save ${t(save)}. ${h.requests.toLocaleString()} requests: ${h.notModified.toLocaleString()} unchanged, ${h.rateLimited} rate-limited, ${h.timeouts} timed out${h.brokenHosts.length ? `, ${h.brokenHosts.length} hosts skipped` : ""}.`;
}

export function healthLine(h: CompanyHealth): string {
  if (!h.ok) return h.error ?? "failed";
  // Past a board's cap, the jobs its search for your titles found (counted in jobsFound too).
  const searched = h.searchFound ? ` (${h.searchFound} past the cap, from searching your titles)` : "";
  return `${String(h.jobsFound).padStart(4)} jobs${searched}, ${h.matches} match${h.matches === 1 ? "" : "es"} (${(h.durationMs / 1000).toFixed(1)}s)`;
}

export function printJobs(jobs: Job[], min: number): void {
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
