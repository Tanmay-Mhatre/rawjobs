import type { IncomingMessage, ServerResponse } from "node:http";
import { APP_VERSION, BUNDLED } from "@rawjobs/core";
import {
  downloadAhead,
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
const CHECK_EVERY = 24 * HOUR;

/**
 * Keeps an installed copy up to date without ever installing on its own: once a day it checks for
 * a new version and downloads it ahead of time (when no scan is running), so the dashboard can say
 * it's ready. It installs only when you click Update now; if a scan (also a scheduled one) is
 * running then, it waits for it to finish. Required updates come up in a window the dashboard
 * shows until you update. Off never checks. The dashboard reads and drives it through /api/update.
 */
export function createUpdater(o: { home: string; isBusy: () => boolean; exit: () => void }) {
  const { home } = o;
  const installed = BUNDLED && !!process.env.RAWJOBS_LAUNCHER && !!installedVersions(home);
  let state: UpdateStatus["state"] = "idle";
  let error: string | undefined;
  let daily: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  let waiter: ReturnType<typeof setInterval> | undefined;
  /** The download ahead of time was put off (a scan was running): try again at the next hourly tick. */
  let prefetchLater = false;

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
      settings: { mode: f.mode, channel: f.channel },
      lastCheck: f.lastCheck,
      available: c?.available ? { ...f.latest!, major: c.major, ready: f.ready?.version === f.latest!.version } : null,
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
        latest: { version: m.version, notes: m.notes, critical: m.critical, date: m.date, minVersion: m.minVersion },
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

  /** The daily check, and the download ahead of time. Never installs. */
  async function tick() {
    const f = readUpdateFile(home);
    if (f.mode === "off" || state !== "idle") return;
    const due = !f.lastCheck || Date.now() - Date.parse(f.lastCheck) > CHECK_EVERY;
    if (!due && !prefetchLater) return;
    const found = await check();
    if (found) await prefetch(found);
  }

  function start() {
    if (!installed) return;
    // "Updated on" / "Installed on": the first time this copy runs this version.
    if (readUpdateFile(home).installed?.version !== APP_VERSION) writeUpdateFile(home, { installed: { version: APP_VERSION, at: new Date().toISOString() } });
    first = setTimeout(() => void tick(), MINUTE);
    daily = setInterval(() => void tick(), HOUR);
  }

  function stop() {
    clearTimeout(first);
    clearInterval(daily);
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
    if (!url.startsWith("/api/update/")) return false;
    if (!installed) {
      json(res, { ...status(), error: "This copy updates with git (git pull), not by itself." }, 400);
      return true;
    }
    if (url === "/api/update/check" && req.method === "POST") {
      const found = await check();
      // Get it ready in the background; the answer doesn't wait for the download.
      if (found) void prefetch(found);
    } else if (url === "/api/update/apply" && req.method === "POST") await apply();
    else if (url === "/api/update/seen" && req.method === "POST") markLastUpdateSeen(home);
    else if (url === "/api/update/shortcut" && req.method === "POST") {
      // Add to Desktop / Repair shortcuts (Settings): what came of it is in about.shortcuts.
      makeShortcuts(home, process.env.RAWJOBS_LAUNCHER!, { desktop: true, version: APP_VERSION });
      markShortcutNoticeSeen(home);
    } else if (url === "/api/update/shortcut-seen" && req.method === "POST") markShortcutNoticeSeen(home);
    else if (url === "/api/update/settings" && req.method === "PUT") {
      const b = JSON.parse((await body()) || "{}") as { mode?: unknown; channel?: unknown };
      const patch: Partial<UpdateSettings> = {};
      if (b.mode === "ask" || b.mode === "off") patch.mode = b.mode;
      if (b.channel === "stable" || b.channel === "beta") patch.channel = b.channel;
      // A new channel has a different newest release.
      const channelChanged = patch.channel !== undefined && patch.channel !== readUpdateFile(home).channel;
      writeUpdateFile(home, channelChanged ? { ...patch, lastCheck: undefined, latest: undefined } : patch);
    } else return false;
    json(res, status());
    return true;
  }

  return { start, status, check, apply, route, stop, updating: () => state === "updating" };
}

export type Updater = ReturnType<typeof createUpdater>;
