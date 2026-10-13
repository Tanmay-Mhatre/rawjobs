import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  defaultDataDir,
  loadConfig,
  scan,
  syncDirectory,
  syncJobFeed,
  scanPlan,
  acquireScanLock,
  releaseScanLock,
  digest,
  finishedMessage,
  sendTelegram,
  telegramSecrets,
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
} from "@rawjobs/core";
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
};

export const parseScope = (v: string | undefined): ScanScope => {
  if (v === undefined || v === "mine" || v === "all") return v ?? "mine";
  throw new Error(`--scope must be "mine" (your companies + your industries) or "all" (every company in the directory), not "${v}".`);
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
    console.error("\nStopping after the companies in progress… (progress is saved; run again to resume)");
  });
  return () => interrupted || existsSync(stopFile(dataDir));
}

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
export async function scanSession<T>(values: RunValues, dataDir: string, o: { busy: () => T; sync: () => Promise<void> }, body: () => Promise<T>): Promise<T> {
  if (!values["dry-run"] && !acquireScanLock(dataDir)) return o.busy();
  try {
    const fullScan = !values.only?.length && !values.check?.length;
    if (fullScan && !values.offline) await o.sync();
    return await body();
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
    },
  });
  if (values.plan) return printPlan(values);
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
    return await scanSession(values, dataDir, { busy, sync }, async () => {
      const { result, merged, summary, checks, moves, stopped } = await scan(config, {
        ...sessionOptions(values, dataDir, scope),
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
      for (const m of moves) console.log(`${m.name}'s careers page is gone. It may have moved to ${m.to.ats}:${m.to.slug}: check it's the same company, then update its link in My companies.`);
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

      const notified = values.notify && !values["dry-run"] ? await notifyScan(config, result, merged) : undefined;
      if (notified)
        console.error(`Telegram: ${notified === "sent" ? "sent the new jobs" : notified === "nothing-new" ? "nothing new to send" : notified === "off" ? "not set up (Settings → Alerts)" : notified}`);
      log({ ok: true, matches: matches.length, newMatches: fresh, notified, stopped });
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
  const plans = Object.fromEntries(
    SCAN_SCOPES.map((scope) => {
      const p = scanPlan(config, dataDir, scope);
      return [scope, { yours: p.yours.length, extra: p.extra.length, seconds: p.seconds, resumable: resumable(dataDir, scope) ?? null }];
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
    const { config, path } = loadConfig(values.config);
    const dataDir = resolve(values.data);
    const busy = () => {
      emit({ type: "error", message: "A scheduled scan is running right now. Its results show up here when it's done." });
      return 0;
    };
    const sync = async () => {
      emit({ type: "sync" });
      emit({ type: "synced", ...(await syncDirectory(dataDir)), ...(values.full ? {} : { feed: (await syncJobFeed(dataDir)).message }) });
    };
    return await scanSession(values, dataDir, { busy, sync }, async () => {
      const yours = new Set(config.companies.map((c) => `${c.ats}:${c.slug}`));
      let done = 0;
      /** Companies done per hiring system, including ones a resumed scan already did. */
      let doneByAts: Record<string, number> = {};
      const { result, merged, summary, checks, moves, stopped } = await scan(config, {
        ...sessionOptions(values, dataDir, scope),
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
      });
      if (existsSync(notifyFile(dataDir))) {
        rmSync(notifyFile(dataDir), { force: true });
        emit({
          type: "notified",
          result: await notifyFinished(
            config,
            matches.filter((j) => merged.newIds.has(j.id)),
            stopped,
          ),
        });
      }
      return 0;
    });
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
    return 1;
  }
}

/** Send how many new matches the scan found (or, with only_new off, how many strong ones) to Telegram. Never throws. */
export async function notifyScan(config: Config, result: RunResult, merged: MergeResult): Promise<string> {
  const secrets = telegramSecrets();
  if (!config.alerts.telegram || !secrets.token || !secrets.chatId) return "off";
  const matches = result.jobs.filter((j) => !j.why.gate);
  const jobs = config.alerts.only_new ? matches.filter((j) => merged.newIds.has(j.id)) : matches.filter((j) => j.score >= config.profile.min_score);
  const text = digest(jobs, { minScore: config.profile.min_score, onlyNew: config.alerts.only_new });
  if (!text) return "nothing-new";
  try {
    await sendTelegram(text, secrets);
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

/** "Tell me when it's done": sent whether or not there's anything new, and whatever the alerts switch says. */
export async function notifyFinished(config: Config, newJobs: Job[], stopped: boolean): Promise<string> {
  const secrets = telegramSecrets();
  if (!secrets.token || !secrets.chatId) return "off";
  try {
    await sendTelegram(finishedMessage({ newJobs, minScore: config.profile.min_score, stopped }), secrets);
    return "sent";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

export function healthLine(h: CompanyHealth): string {
  if (!h.ok) return h.error ?? "failed";
  return `${String(h.jobsFound).padStart(4)} jobs, ${h.matches} match${h.matches === 1 ? "" : "es"} (${(h.durationMs / 1000).toFixed(1)}s)`;
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
