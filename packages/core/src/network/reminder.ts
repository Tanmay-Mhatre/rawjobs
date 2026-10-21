/**
 * "Remind me in 48 hours if I haven't added the file": LinkedIn emails its export within a day or so,
 * and this reminds you to add it. Node only.
 *
 * The reminder lives in profile/network-reminder.json (its own file, so the Downloads watch keeps its
 * own semantics). When its time comes and no connections were imported since it was set, it's marked
 * due on disk first (so it never fires twice, also after a restart or from a second server), then one
 * Telegram message goes out if Telegram alerts are on. It stays due for the app until you add the
 * file, snooze it or dismiss it. Importing connections, deleting them or starting setup over clears it.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeFileAtomic } from "../atomic";
import { type TelegramSecrets, telegramMessage } from "../notify";
import type { NetworkStore } from "./store";
import type { ReminderState } from "./types";

export const NETWORK_REMINDER_PATH = "profile/network-reminder.json";
/** The default reminder, the snooze, and the longest one. */
export const REMINDER_DEFAULT_HOURS = 48;
export const REMINDER_SNOOZE_HOURS = 24;
export const REMINDER_MAX_HOURS = 72;
/** A timer never waits longer than this, so a laptop that slept through the time catches up soon after. */
const MAX_WAIT_MS = 10 * 60_000;
const HOUR = 3_600_000;

/** What profile/network-reminder.json holds. */
type ReminderFile = { app: "rawjobs"; kind: "network-reminder"; version: 1; setAt: string; remindAt: string; dueAt?: string };

/** The Telegram message: header, facts, action, and nothing about your connections. */
export const reminderMessage = () =>
  telegramMessage("🔗 <b>Your LinkedIn file</b>", "LinkedIn's copy of your data should be ready by now.", "Add it in RawJobs on your computer to see who you know at your jobs.");

export type ReminderDeps = {
  now: () => number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (timer: unknown) => void;
  /** Telegram, when alerts are set up and on; null otherwise (then nothing is sent). */
  telegram: () => TelegramSecrets | null;
  send: (text: string, secrets: TelegramSecrets) => Promise<void>;
  log: (line: string) => void;
};

export function createReminder(home: string, store: Pick<NetworkStore, "status">, deps: ReminderDeps) {
  const path = resolve(home, NETWORK_REMINDER_PATH);
  let timer: unknown = null;
  let checking = false;

  function read(): ReminderFile | null {
    let r: Partial<ReminderFile> | null;
    try {
      r = JSON.parse(readFileSync(path, "utf8")) as Partial<ReminderFile> | null;
    } catch {
      return null;
    }
    const ok =
      r &&
      r.app === "rawjobs" &&
      r.kind === "network-reminder" &&
      r.version === 1 &&
      typeof r.setAt === "string" &&
      typeof r.remindAt === "string" &&
      Number.isFinite(Date.parse(r.setAt)) &&
      Number.isFinite(Date.parse(r.remindAt)) &&
      (r.dueAt === undefined || typeof r.dueAt === "string");
    if (!ok) {
      rmSync(path, { force: true });
      return null;
    }
    // Connections came in after it was set (from a file you chose or the Downloads watch): no need for it.
    const s = store.status();
    if (s.connected && Date.parse(s.importedAt) >= Date.parse((r as ReminderFile).setAt)) {
      rmSync(path, { force: true });
      return null;
    }
    return r as ReminderFile;
  }
  function stopTimer() {
    if (timer !== null) deps.cancel(timer);
    timer = null;
  }
  function plan(f: ReminderFile | null) {
    stopTimer();
    if (!f || f.dueAt) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, Date.parse(f.remindAt) - deps.now()));
    timer = deps.schedule(() => void check(), wait);
  }

  /** Fire a reminder whose time has come. Exposed for tests; the timer calls it. */
  async function check(): Promise<void> {
    timer = null;
    if (checking) return;
    checking = true;
    try {
      const f = read();
      if (!f || f.dueAt) return;
      const now = deps.now();
      if (Date.parse(f.remindAt) > now) return plan(f);
      // Due first, on disk: a restart or a second server never sends it again.
      writeFileAtomic(path, `${JSON.stringify({ ...f, dueAt: new Date(now).toISOString() } satisfies ReminderFile)}\n`);
      deps.log("LinkedIn file reminder is due.");
      const secrets = deps.telegram();
      if (!secrets) return;
      try {
        await deps.send(reminderMessage(), secrets);
      } catch (err) {
        deps.log(`Couldn't send the LinkedIn file reminder on Telegram: ${(err as Error).message}`);
      }
    } finally {
      checking = false;
    }
  }

  return {
    check,
    /** The reminder, or null. */
    state(): ReminderState | null {
      const f = read();
      return f ? { at: f.remindAt, due: !!f.dueAt } : null;
    },
    /** Remind in `hours` (48 by default, at most 72); also how a due one is snoozed. */
    set(hours = REMINDER_DEFAULT_HOURS): ReminderState {
      const h = Math.min(REMINDER_MAX_HOURS, Math.max(0.1, Number.isFinite(hours) ? hours : REMINDER_DEFAULT_HOURS));
      const t = deps.now();
      const f: ReminderFile = { app: "rawjobs", kind: "network-reminder", version: 1, setAt: new Date(t).toISOString(), remindAt: new Date(t + h * HOUR).toISOString() };
      mkdirSync(dirname(path), { recursive: true });
      writeFileAtomic(path, `${JSON.stringify(f)}\n`);
      plan(f);
      return { at: f.remindAt, due: false };
    },
    /** Cancel or dismiss it. */
    clear(): void {
      stopTimer();
      rmSync(path, { force: true });
    },
    /** On server start: fire one missed while it was down, or wait for it. */
    resume(): void {
      const f = read();
      if (f && !f.dueAt && Date.parse(f.remindAt) <= deps.now()) void check();
      else plan(f);
    },
    /** Before the server exits: stop the timer, keep the reminder for the next start. */
    close(): void {
      stopTimer();
    },
  };
}

export type Reminder = ReturnType<typeof createReminder>;
