import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  missedScan,
  OUTBOX_FILE,
  OVERDUE_RUN,
  overdueScheduledRun,
  recordScheduledRun,
  readScheduledRuns,
  readScheduleSettings,
  runCommitted,
  scanLockHeld,
  scanLockHolder,
  scheduleSavedAt,
  sendTelegramQueued,
  type TelegramSecrets,
  telegramSecrets,
  telegramStatus,
  tryWithLock,
} from "@rawjobs/core";
import { BEACON_URL } from "@rawjobs/core/update";

/** First look this long after the server starts or the computer wakes: the network and the laptop settle first. */
export const SETTLE_MS = 2 * 60_000;
/** Then every 15 minutes, in case a wake went unnoticed. */
export const CHECK_EVERY_MS = 15 * 60_000;
/** A gap this long between one-minute ticks means the computer was asleep. */
const WAKE_GAP_MS = 3 * 60_000;
const TICK_MS = 60_000;

export type CatchUpDeps = {
  dataDir: string;
  /** A scan or update this server is busy with. */
  busy: () => boolean;
  /** Run the RawJobs CLI (the server's own `collect`). */
  cli: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Whether the internet answers: a catch-up without it would fall back to checking every company itself. */
  online?: () => Promise<boolean>;
  log?: (line: string) => void;
  now?: () => number;
  platform?: NodeJS.Platform;
  /** Send alerts waiting in the Telegram outbox (default flushAlerts). */
  flush?: () => Promise<string | null>;
  /** End a process (default process.kill); tests pass a fake. */
  kill?: (pid: number) => void;
};

/** How long a scan far past its limit gets to stop by itself, once asked, before it's ended. */
export const OVERDUE_GRACE_MS = 10 * 60_000;

/**
 * Send the scan alerts waiting in the Telegram outbox: written ahead by a scan killed after it
 * saved, or kept while offline. Done under the scan lock, so it never races a scan's own send; null
 * when a scan holds it (that scan sends them). An alert whose scan never saved is dropped.
 */
export async function flushAlerts(dataDir: string, o: { secrets?: TelegramSecrets; enabled?: boolean; fetchImpl?: typeof fetch } = {}): Promise<string | null> {
  if (!existsSync(join(dataDir, OUTBOX_FILE))) return "nothing";
  const secrets = o.secrets ?? telegramSecrets();
  if (!(o.enabled ?? telegramStatus().enabled) || !secrets.token || !secrets.chatId) return "off";
  return tryWithLock(join(dataDir, "scan.lock"), () => sendTelegramQueued(dataDir, undefined, secrets, { fetchImpl: o.fetchImpl, committed: (run) => runCommitted(dataDir, run) }), { waitMs: 0 });
}

async function beaconAnswers(): Promise<boolean> {
  try {
    await fetch(BEACON_URL, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the scheduled scan when its time passed while the computer was off or asleep, as soon as
 * it's back on and online: the operating system's own catch-up is unreliable on Windows and never
 * happens on a Mac that was shut down. On Windows it also puts the scheduled tasks back on your local
 * times after a time zone change. Returns `tick` (for tests) and `stop`.
 */
export function watchMissedScans(d: CatchUpDeps): { tick: () => Promise<void>; stop: () => void } {
  const now = d.now ?? Date.now;
  const log = d.log ?? console.log;
  const online = d.online ?? beaconAnswers;
  const windows = (d.platform ?? process.platform) === "win32";
  let lastTick = now();
  let checkAt = lastTick + SETTLE_MS;
  // Once after start on every system: schedules installed by an older version are written again
  // (refreshSchedules); on Windows the tasks' times are checked too, again after each wake.
  let repairDue = true;
  let started: number | undefined;
  let running = false;
  const flush = d.flush ?? (() => flushAlerts(d.dataDir));
  let flushed = false;
  /** The overdue scan asked to stop, and when. */
  let asked: { pid: number; at: number } | undefined;

  /**
   * A scheduled scan still running long after its time limit (on Windows, Task Scheduler's limit
   * ends only the console wrapper; a scan from before deadlines never stops by itself) holds the
   * scan lock, so no other scan runs. Ask it to stop (it saves its progress); end it if it doesn't.
   * True while one is being dealt with.
   */
  function stopOverdue(): boolean {
    const runs = readScheduledRuns(d.dataDir);
    const run = overdueScheduledRun(runs, scanLockHolder(d.dataDir), now());
    if (!run?.pid) {
      asked = undefined;
      return false;
    }
    checkAt = now() + TICK_MS;
    if (asked?.pid !== run.pid) {
      asked = { pid: run.pid, at: now() };
      writeFileSync(join(d.dataDir, "scan-stop"), "");
      log(`A scheduled scan has run for ${Math.round((now() - Date.parse(run.startedAt)) / 3_600_000)} h, far past its time limit: asked it to stop.`);
    } else if (now() - asked.at > OVERDUE_GRACE_MS) {
      try {
        (d.kill ?? process.kill)(run.pid);
      } catch {
        // gone already
      }
      recordScheduledRun(d.dataDir, { ...run, pid: undefined, running: undefined, finishedAt: new Date(now()).toISOString(), ok: false, error: OVERDUE_RUN });
      log("The overdue scheduled scan didn't stop by itself: ended it.");
      asked = undefined;
    }
    return true;
  }

  async function check(): Promise<void> {
    if (stopOverdue()) return;
    // Once after start (again only if a scan held the lock or the send failed): alerts a killed scan left.
    if (!flushed && !d.busy()) {
      const r = await flush();
      flushed = r !== null && !r.startsWith("failed");
      if (r?.startsWith("failed")) log(`Couldn't send the waiting Telegram alerts: ${r.slice(8)}`);
    }
    if (repairDue) {
      repairDue = false;
      const r = await d.cli(["schedule", "repair", "--data", d.dataDir]);
      try {
        const fixed = (JSON.parse(r.stdout.trim()) as { fixed?: string[] }).fixed ?? [];
        if (fixed.length) log(`Put the scheduled tasks back on your local time: ${fixed.join("; ")}.`);
        // A scan held the lock: write the schedules again at the next look.
        if ((JSON.parse(r.stdout.trim()) as { refreshed?: boolean }).refreshed === false) repairDue = true;
      } catch {
        log(`Couldn't check the scheduled tasks' times: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
      }
    }
    const settings = readScheduleSettings(d.dataDir);
    if (!settings) return;
    const slot = missedScan(settings.times, readScheduledRuns(d.dataDir), new Date(now()), scheduleSavedAt(d.dataDir));
    // Started for this time already: the scan writes its run when it finishes.
    if (!slot || (started !== undefined && started >= slot.getTime())) return;
    if (d.busy() || scanLockHeld(d.dataDir)) return;
    if (!(await online())) {
      // Offline: look again in a minute, not in 15.
      checkAt = now() + TICK_MS;
      return;
    }
    started = now();
    log(`The scheduled scan for ${slot.toLocaleString()} was missed while the computer was off or asleep: starting it now.`);
    const r = await d.cli(["schedule", "run", "--catch-up", "--data", d.dataDir]);
    if (r.code !== 0 || r.stdout.includes('"ok":false')) log(`Couldn't start the catch-up scan: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  }

  async function tick(): Promise<void> {
    const t = now();
    if (t - lastTick > WAKE_GAP_MS) {
      // Just woke up: settle, then look (and on Windows, check the time zone didn't change).
      checkAt = Math.min(checkAt, t + SETTLE_MS);
      repairDue = windows;
    }
    lastTick = t;
    if (t < checkAt || running) return;
    checkAt = t + CHECK_EVERY_MS;
    running = true;
    try {
      await check();
    } catch (err) {
      log(`The missed-scan check failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
