import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { APP_VERSION, BUNDLED, CODE_ROOT, loadConfig, sendTelegram, telegramMessage, telegramSecrets } from "@rawjobs/core";
import { type ChangelogEntry, compareVersions, type ReleaseChange } from "@rawjobs/core/release";
import {
  beaconVersion,
  downloadAhead,
  fetchBeacon,
  fetchManifest,
  installedVersions,
  judge,
  markLastUpdateSeen,
  readLastUpdate,
  readUpdateFile,
  releaseBase,
  startUpdate,
  writeUpdateFile,
  type UpdateCheck,
  type UpdateRecord,
  type UpdateSettings,
} from "@rawjobs/core/update";
import { makeShortcuts, markShortcutNoticeSeen, shortcutState, type ShortcutState } from "./shortcuts";

export type UpdateStatus = {
  /** An installed copy (from the install line), which can update itself. A checkout updates with git. */
  installed: boolean;
  current: string;
  settings: UpdateSettings;
  lastCheck?: string;
  available: {
    version: string;
    notes: string;
    /** Its "New / Improved / Fixed" lines (empty for a release written before them). */
    changes?: ReleaseChange[];
    /** A required update: the dashboard asks for it in a window that only closes by updating. */
    critical: boolean;
    date: string;
    major: boolean;
    /** Downloaded and checked already: installing takes a few seconds. */
    ready: boolean;
  } | null;
  /** Too old to update straight to the newest release: run the install line again. */
  tooOld: boolean;
  /**
   * idle; checking (for a new version); downloading (it, ahead of time); waiting (you said update,
   * and it will once the scan that's running is done); updating (restarting into it).
   */
  state: "idle" | "checking" | "downloading" | "waiting" | "updating";
  error?: string;
  /** How the last update went, until you've seen it. */
  lastUpdate: UpdateRecord | null;
  /** For Settings → About. */
  about: {
    /** When this version first ran here, and whether it came by an update (else: installed). */
    since?: { at: string; by: "update" | "install" };
    home: string;
    node: string;
    platform: string;
    /** The RawJobs shortcuts on this computer (null: not an installed copy). */
    shortcuts: ShortcutState | null;
  };
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** How often it reads the beacon: every 5 minutes, give or take one (so copies don't all ask at once). */
const WATCH_EVERY = 5 * MINUTE;
const JITTER = MINUTE;
/** When the beacon can't be read: wait longer each time (5, 10, 20… minutes), up to an hour. */
const MAX_BACKOFF = HOUR;
/** And when it hasn't been read for this long, ask GitHub directly (as before the beacon). */
const DIRECT_AFTER = 6 * HOUR;
/** Coming back to the dashboard reads the beacon too, at most this often. */
const FOCUS_EVERY = MINUTE;

/** Every release's notes up to this version, newest first (the bundle's changelog.json; none in a checkout). */
export function readChangelog(): ChangelogEntry[] {
  try {
    return JSON.parse(readFileSync(join(CODE_ROOT, "changelog.json"), "utf8")) as ChangelogEntry[];
  } catch {
    return [];
  }
}

/**
 * Keeps an installed copy up to date, over the air, without ever installing on its own. Every few
 * minutes (and at start, and when you come back to the dashboard) it reads the beacon, a tiny file
 * naming the newest version (core update.ts, fetchBeacon). When that names a newer version, it gets
 * the signed release from GitHub and downloads it in the background (after any scan that's
 * running). Then it says so: an Update pill in the dashboard (seen within seconds through
 * /api/health's updateHint), and a Telegram message if Telegram alerts are set up. It installs only
 * when you click the pill; if a scan (also a scheduled one) is running then, it waits for it to
 * finish. Required updates come up in a window the dashboard shows until you update. Off never
 * checks. The dashboard reads and drives it through /api/update.
 */
export function createUpdater(o: {
  home: string;
  isBusy: () => boolean;
  exit: () => void;
  /** Tests: act as an installed copy without being one. */
  installed?: boolean;
}) {
  const { home } = o;
  const installed = o.installed ?? (BUNDLED && !!process.env.RAWJOBS_LAUNCHER && !!installedVersions(home));
  let state: UpdateStatus["state"] = "idle";
  let error: string | undefined;
  let next: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  /** The download ahead of time was put off (a scan was running): try again at the next look. */
  let prefetchLater = false;
  /** Beacon reads that failed in a row (for the back-off). */
  let failures = 0;
  let lastLook = 0;

  const judged = (): UpdateCheck | null => {
    const f = readUpdateFile(home);
    if (!f.latest) return null;
    return judge(APP_VERSION, { ...f.latest, app: "rawjobs", bundleFile: "", bundleSha256: "", nodeVersion: "", nodeSha256: {} }, f.skip);
  };

  function status(): UpdateStatus {
    const f = readUpdateFile(home);
    const c = installed ? judged() : null;
    const last = readLastUpdate(home);
    const since = f.installed?.version === APP_VERSION ? f.installed.at : undefined;
    return {
      installed,
      current: APP_VERSION,
      settings: { mode: f.mode, channel: f.channel, telegram: f.telegram },
      lastCheck: f.lastCheck,
      available: c?.available ? { ...f.latest!, changes: f.latest!.changes ?? [], major: c.major, ready: f.ready?.version === f.latest!.version } : null,
      tooOld: !!c?.tooOld,
      state,
      error,
      lastUpdate: last && !last.seen ? last : null,
      about: {
        since: since ? { at: since, by: last?.ok && last.to === APP_VERSION ? "update" : "install" } : undefined,
        home,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        shortcuts: installed ? shortcutState(home) : null,
      },
    };
  }

  async function check(): Promise<{ check: UpdateCheck; base: string } | null> {
    if (state !== "idle") return null;
    state = "checking";
    error = undefined;
    try {
      const f = readUpdateFile(home);
      const base = await releaseBase(f.channel);
      const m = await fetchManifest(base);
      writeUpdateFile(home, {
        lastCheck: new Date().toISOString(),
        latest: { version: m.version, notes: m.notes, critical: m.critical, date: m.date, minVersion: m.minVersion, changes: m.changes ?? [] },
      });
      return { check: judge(APP_VERSION, m, f.skip), base };
    } catch (err) {
      const offline = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|aborted|timeout/i.test(String((err as Error).message) + String((err as { cause?: unknown }).cause ?? ""));
      error = offline ? "Couldn't reach GitHub to get the update. Check your internet connection, then try again." : `Couldn't check for updates: ${(err as Error).message}`;
      return null;
    } finally {
      state = "idle";
    }
  }

  /** Download a new version ahead of time, quietly: a failure only means Update now downloads it. */
  async function prefetch(found: { check: UpdateCheck; base: string }) {
    if (!found.check.available || found.check.tooOld || state !== "idle") return;
    prefetchLater = o.isBusy();
    if (prefetchLater) return;
    state = "downloading";
    try {
      await downloadAhead(home, found.base, found.check.manifest);
    } catch (err) {
      console.log(`Couldn't download RawJobs ${found.check.manifest.version} ahead of time: ${(err as Error).message}`);
    } finally {
      state = "idle";
    }
  }

  async function install(): Promise<void> {
    const found = await check();
    if (!found) return;
    if (found.check.tooOld) {
      error = "This version is too old to update by itself. Run the install line again to get the newest one.";
      return;
    }
    if (!found.check.available) return;
    state = "updating";
    try {
      await startUpdate({ home, base: found.base, manifest: found.check.manifest, serverPid: process.pid });
      // The old version, in its own process, now starts the new one and checks it answers.
      setTimeout(o.exit, 300);
    } catch (err) {
      state = "idle";
      error = `Couldn't update: ${(err as Error).message}`;
    }
  }

  /** Update now: right away when nothing is running, else as soon as the scan is done. */
  async function apply(): Promise<void> {
    if (state === "updating" || state === "waiting") return;
    error = undefined;
    if (!o.isBusy() && state === "idle") return install();
    state = "waiting";
    clearInterval(waiter);
    waiter = setInterval(() => {
      if (o.isBusy()) return;
      clearInterval(waiter);
      state = "idle";
      void install();
    }, 15 * 1000);
  }

  /**
   * One look for a new version, never an install: read the beacon; when it names a version newer
   * than this one (and not downloaded yet), get the signed release and download it. When the beacon
   * can't be read for hours, ask GitHub directly. Returns how long to wait before the next look.
   */
  async function look(): Promise<number> {
    lastLook = Date.now();
    const f = readUpdateFile(home);
    if (f.mode === "off" || state !== "idle") return WATCH_EVERY;
    let wanted = false;
    try {
      const r = await fetchBeacon(f.beacon?.etag);
      const b = r.same ? f.beacon : { etag: r.etag, stable: r.beacon.stable?.version, beta: r.beacon.beta?.version };
      writeUpdateFile(home, { beacon: { ...b, checkedAt: new Date().toISOString() } });
      failures = 0;
      const v = beaconVersion(b, f.channel);
      // Newer than this version, and not already found and downloaded.
      wanted = !!v && compareVersions(v, APP_VERSION) > 0 && !(f.skip ?? []).includes(v) && (f.latest?.version !== v || f.ready?.version !== v);
    } catch (err) {
      failures++;
      const quiet = Date.now() - Date.parse(f.beacon?.checkedAt ?? f.lastCheck ?? "1970-01-01");
      // Can't reach the beacon for a long while: GitHub, at most hourly.
      wanted = quiet > DIRECT_AFTER && (!f.lastCheck || Date.now() - Date.parse(f.lastCheck) > HOUR);
      if (failures === 1) console.log(`Couldn't read the update beacon: ${(err as Error).message}`);
    }
    if (wanted || prefetchLater) {
      const found = await check();
      if (found) await prefetch(found);
    }
    await announce();
    return failures ? Math.min(WATCH_EVERY * 2 ** (failures - 1), MAX_BACKOFF) : WATCH_EVERY + Math.round((Math.random() * 2 - 1) * JITTER);
  }

  /** Look now, then keep looking: every few minutes, or longer while it can't reach the beacon. */
  function watch(delay: number) {
    clearTimeout(next);
    if (stopped) return;
    next = setTimeout(() => {
      void look()
        .catch(() => WATCH_EVERY)
        .then((wait) => watch(wait));
    }, delay);
  }

  /**
   * A Telegram message once a new version is downloaded and ready, once per version, when Telegram
   * alerts are set up and turned on (and this message isn't turned off in Settings). From this
   * computer to your own bot, like scan alerts.
   */
  async function announce() {
    const f = readUpdateFile(home);
    const l = f.latest;
    if (!l || f.ready?.version !== l.version || f.notified === l.version || !f.telegram) return;
    if (compareVersions(l.version, APP_VERSION) <= 0) return;
    let on = false;
    try {
      on = loadConfig().config.alerts.telegram;
    } catch {
      // no config yet: no alerts
    }
    const secrets = telegramSecrets(home);
    if (!on || !secrets.token || !secrets.chatId) return;
    try {
      await sendTelegram(updateMessage(l.version, l.critical), secrets);
      writeUpdateFile(home, { notified: l.version });
    } catch (err) {
      // Tried again at the next look.
      console.log(`Couldn't send the update message on Telegram: ${(err as Error).message}`);
    }
  }

  function start() {
    if (!installed) return;
    // "Updated on" / "Installed on": the first time this copy runs this version.
    if (readUpdateFile(home).installed?.version !== APP_VERSION) writeUpdateFile(home, { installed: { version: APP_VERSION, at: new Date().toISOString() } });
    // Soon after start: a copy that was off all night hears about the night's release.
    watch(30 * 1000);
  }

  /**
   * For /api/health, which the dashboard asks every 5 seconds: the version waiting to be installed,
   * so an open dashboard shows the Update pill within seconds of the server finding it.
   */
  function updateHint(): { version: string; critical: boolean } | null {
    if (!installed) return null;
    const c = judged();
    return c?.available && !c.tooOld ? { version: c.manifest.version, critical: c.manifest.critical } : null;
  }

  /** Release notes for Settings → About and "What's new": this version's history, and the one waiting, if any. */
  function changelog(): { current: string; entries: ChangelogEntry[]; upcoming: ChangelogEntry | null } {
    const f = readUpdateFile(home);
    const entries = readChangelog().filter((e) => compareVersions(e.version, APP_VERSION) <= 0);
    const l = f.latest;
    const upcoming = installed && l && compareVersions(l.version, APP_VERSION) > 0 ? { version: l.version, date: l.date, notes: l.notes, changes: l.changes ?? [], critical: l.critical } : null;
    return { current: APP_VERSION, entries, upcoming };
  }

  function stop() {
    stopped = true;
    clearTimeout(next);
    clearInterval(waiter);
  }

  function json(res: ServerResponse, body: unknown, code = 200) {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  }

  /** /api/update routes. Returns false for other URLs. */
  async function route(url: string, req: IncomingMessage, res: ServerResponse, body: () => Promise<string>): Promise<boolean> {
    if (url === "/api/update" && req.method === "GET") {
      json(res, status());
      return true;
    }
    if (url === "/api/update/changelog" && req.method === "GET") {
      json(res, changelog());
      return true;
    }
    if (!url.startsWith("/api/update/")) return false;
    if (!installed) {
      json(res, { ...status(), error: "This copy updates with git (git pull), not by itself." }, 400);
      return true;
    }
    if (url === "/api/update/check" && req.method === "POST") {
      const found = await check();
      // Get it ready in the background; the answer doesn't wait for the download.
      if (found) void prefetch(found);
    } else if (url === "/api/update/focus" && req.method === "POST") {
      // You came back to the dashboard: look for a new version now (unless it just did), in the background.
      if (Date.now() - lastLook > FOCUS_EVERY && state === "idle") watch(0);
    } else if (url === "/api/update/apply" && req.method === "POST") await apply();
    else if (url === "/api/update/seen" && req.method === "POST") markLastUpdateSeen(home);
    else if (url === "/api/update/shortcut" && req.method === "POST") {
      // Add to Desktop / Repair shortcuts (Settings): what came of it is in about.shortcuts.
      makeShortcuts(home, process.env.RAWJOBS_LAUNCHER!, { desktop: true, version: APP_VERSION });
      markShortcutNoticeSeen(home);
    } else if (url === "/api/update/shortcut-seen" && req.method === "POST") markShortcutNoticeSeen(home);
    else if (url === "/api/update/settings" && req.method === "PUT") {
      const b = JSON.parse((await body()) || "{}") as { mode?: unknown; channel?: unknown; telegram?: unknown };
      const patch: Partial<UpdateSettings> = {};
      if (b.mode === "ask" || b.mode === "off") patch.mode = b.mode;
      if (b.channel === "stable" || b.channel === "beta") patch.channel = b.channel;
      if (typeof b.telegram === "boolean") patch.telegram = b.telegram;
      // A new channel has a different newest release.
      const channelChanged = patch.channel !== undefined && patch.channel !== readUpdateFile(home).channel;
      writeUpdateFile(home, channelChanged ? { ...patch, lastCheck: undefined, latest: undefined, beacon: undefined } : patch);
      if (channelChanged) watch(0);
    } else return false;
    json(res, status());
    return true;
  }

  return { start, status, check, apply, route, stop, look, updateHint, updating: () => state === "updating" };
}

export type Updater = ReturnType<typeof createUpdater>;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Telegram message for a downloaded update (HTML, as sendTelegram sends it). What changed is in the app. */
export function updateMessage(version: string, critical: boolean): string {
  const ready = `RawJobs <b>${esc(version)}</b> is ready to install.`;
  return critical
    ? telegramMessage("⚠️ <b>Update required</b>", ready, "Open RawJobs on your computer and click Update.")
    : telegramMessage("⬆️ <b>Update ready</b>", `${ready}\nNothing changes until you do.`, "Open RawJobs on your computer and click Update.");
}
