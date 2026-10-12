import type { IncomingMessage, ServerResponse } from "node:http";
import { APP_VERSION, BUNDLED } from "../../core/src/runtime";
import {
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
} from "../../core/src/update";

export type UpdateStatus = {
  /** An installed copy (from the install line), which can update itself. A checkout updates with git. */
  installed: boolean;
  current: string;
  settings: UpdateSettings;
  lastCheck?: string;
  available: { version: string; notes: string; critical: boolean; date: string; major: boolean } | null;
  /** Too old to update straight to the newest release: run the install line again. */
  tooOld: boolean;
  state: "idle" | "checking" | "updating";
  error?: string;
  /** How the last update went, until you've seen it. */
  lastUpdate: UpdateRecord | null;
};

const HOUR = 60 * 60 * 1000;
const CHECK_EVERY = 24 * HOUR;

/**
 * Keeps an installed copy up to date: checks once a day, and with updates on Automatic installs a
 * new version (not a new major one) when no scan is running. Ask me only shows it, except a
 * critical fix. Off never checks. The dashboard reads and drives it through /api/update.
 */
export function createUpdater(o: { home: string; isBusy: () => boolean; exit: () => void }) {
  const { home } = o;
  const installed = BUNDLED && !!process.env.RAWJOBS_LAUNCHER && !!installedVersions(home);
  let state: UpdateStatus["state"] = "idle";
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const judged = (): UpdateCheck | null => {
    const f = readUpdateFile(home);
    if (!f.latest) return null;
    return judge(APP_VERSION, { ...f.latest, app: "rawjobs", bundleFile: "", bundleSha256: "", nodeVersion: "", nodeSha256: {} }, f.skip);
  };

  function status(): UpdateStatus {
    const f = readUpdateFile(home);
    const c = installed ? judged() : null;
    const last = readLastUpdate(home);
    return {
      installed,
      current: APP_VERSION,
      settings: { mode: f.mode, channel: f.channel },
      lastCheck: f.lastCheck,
      available: c?.available ? { ...f.latest!, major: c.major } : null,
      tooOld: !!c?.tooOld,
      state,
      error,
      lastUpdate: last && !last.seen ? last : null,
    };
  }

  async function check(): Promise<{ check: UpdateCheck; base: string } | null> {
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
      error = `Couldn't check for updates: ${(err as Error).message}`;
      return null;
    } finally {
      state = "idle";
    }
  }

  let applying = false;
  async function apply(): Promise<void> {
    // A second click while one is under way would share (and delete) its download folder.
    if (applying || state === "updating") return;
    applying = true;
    try {
      await applyOnce();
    } finally {
      applying = false;
    }
  }

  async function applyOnce(): Promise<void> {
    if (o.isBusy()) {
      error = "A scan is running. RawJobs updates when it's done.";
      return;
    }
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

  /** The daily check, and the automatic install. */
  async function tick() {
    const f = readUpdateFile(home);
    if (f.mode === "off") return;
    const due = !f.lastCheck || Date.now() - Date.parse(f.lastCheck) > CHECK_EVERY;
    const c = due ? (await check())?.check : judged();
    if (!c?.available || c.tooOld) return;
    const wanted = f.mode === "auto" ? !c.major || c.manifest.critical : c.manifest.critical;
    if (!wanted) return;
    if (o.isBusy()) {
      // Try again when the scan is likely done.
      timer = setTimeout(() => void tick(), 10 * 60 * 1000);
      return;
    }
    await apply();
  }

  function start() {
    if (!installed) return;
    timer = setTimeout(() => {
      void tick();
      timer = setInterval(() => void tick(), HOUR);
    }, 60 * 1000);
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
    if (url === "/api/update/check" && req.method === "POST") await check();
    else if (url === "/api/update/apply" && req.method === "POST") await apply();
    else if (url === "/api/update/seen" && req.method === "POST") markLastUpdateSeen(home);
    else if (url === "/api/update/settings" && req.method === "PUT") {
      const b = JSON.parse((await body()) || "{}") as Partial<UpdateSettings>;
      const patch: Partial<UpdateSettings> = {};
      if (b.mode === "auto" || b.mode === "ask" || b.mode === "off") patch.mode = b.mode;
      if (b.channel === "stable" || b.channel === "beta") patch.channel = b.channel;
      // A new channel has a different newest release.
      const channelChanged = patch.channel !== undefined && patch.channel !== readUpdateFile(home).channel;
      writeUpdateFile(home, channelChanged ? { ...patch, lastCheck: undefined, latest: undefined } : patch);
    } else return false;
    json(res, status());
    return true;
  }

  return { start, status, check, apply, route, stop: () => clearTimeout(timer) };
}

export type Updater = ReturnType<typeof createUpdater>;
