import { missedScan, readScheduledRuns, readScheduleSettings, scanLockHeld, scheduleSavedAt } from "@rawjobs/core";
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
};

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
  let repairDue = windows;
  let started: number | undefined;
  let running = false;

  async function check(): Promise<void> {
    if (repairDue) {
      repairDue = false;
      const r = await d.cli(["schedule", "repair", "--data", d.dataDir]);
      try {
        const fixed = (JSON.parse(r.stdout.trim()) as { fixed?: string[] }).fixed ?? [];
        if (fixed.length) log(`Put the scheduled tasks back on your local time: ${fixed.join("; ")}.`);
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
