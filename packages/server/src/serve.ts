import { existsSync, mkdirSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { createServer, type Server } from "node:http";
import { parseArgs } from "node:util";
import { defaultDataDir, rawjobsHome } from "@rawjobs/core";
import { APP_VERSION, BUNDLED, collectReports, migrateData, recentCrashes, recordCrash, reportFatalErrors, SAFE_MODE_CRASHES, scanLockHeld, WEB_DIR } from "@rawjobs/core";
import { dirname, join } from "node:path";
import { watchMissedScans } from "./catch-up";
import { createApi } from "./api";
import { createUpdater } from "./updater";
import { alreadyRunning, DEFAULT_PORT, ensureAutostart, logTo, openBrowser, readServerState, takeServerLock, watchEventLoop, writeServerState } from "./desktop";
import { makeHomePrivate } from "./private-home";
import { ensureShortcuts, startLinkInstalled } from "./shortcuts";
import { createHandler } from "./handler";

const TRIES = 10;
/** How long a server in safe mode (after crashing again and again) goes without its background work. */
const SAFE_MODE_MS = 30 * 60_000;
let safeMode = false;

/**
 * The dashboard and its API, without the dev server (`rawjobs serve`, `pnpm start`). Runs until
 * Ctrl+C or the computer's scheduler stops it; a scan that's running saves its progress and can be
 * resumed next time.
 */
export async function serve(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, open: { type: "boolean", default: false }, log: { type: "string" } } });
  const log = values.log ? logTo(values.log) : undefined;
  // A crash ends the server (resuming after one isn't safe) and its supervisor starts it again: the
  // stack goes to the log and logs/crashes.json first, which Node itself would only print to a
  // console nobody sees. Fatal errors with no exception (out of memory) leave a report instead.
  const logDir = join(rawjobsHome(), "logs");
  process.on("uncaughtExceptionMonitor", (err, origin) => recordCrash(logDir, err, { origin, where: "server", version: APP_VERSION, log }));
  reportFatalErrors(logDir);
  // The dashboard answers at normal priority, also when a copy installed before started it lower
  // (scans still lower their own).
  try {
    setPriority(constants.priority.PRIORITY_NORMAL);
  } catch {
    // not allowed here
  }
  // Your files are yours alone on macOS and Linux: everything written from here on, and (once) the
  // installed copy's folder itself. A dev checkout's folder is left as it is.
  if (process.platform !== "win32") process.umask(0o077);
  const home = rawjobsHome();
  const dataDir = defaultDataDir(home);
  mkdirSync(dataDir, { recursive: true });
  if (BUNDLED) makeHomePrivate(home);
  if (process.env.RAWJOBS_DATA_PUBLIC_KEY || process.env.JOBHUNTER_DATA_PUBLIC_KEY) console.log("Using a custom data signing key (RAWJOBS_DATA_PUBLIC_KEY).");
  if (!existsSync(`${WEB_DIR}/index.html`)) {
    console.error(
      BUNDLED
        ? `This copy of RawJobs is missing its dashboard (${WEB_DIR}). Run the install line again to repair it.`
        : "The dashboard isn't built yet. Run `pnpm build` first (or `pnpm start`, which builds it).",
    );
    return 1;
  }

  // One server per RawJobs folder: starting it again (at login, from the shortcut) finds the running one.
  const running = readServerState(home);
  const found = values.port ? null : await alreadyRunning(running, home);
  if (found === "running") {
    console.log(`RawJobs is already running at http://127.0.0.1:${running!.port}`);
    if (values.open) openBrowser(`http://127.0.0.1:${running!.port}`);
    return 0;
  }
  if (found === "stuck") {
    console.error(
      `RawJobs (process ${running!.pid}) still holds port ${running!.port} but doesn't answer, so a second one isn't started next to it. Restart the computer, or end that process, to start RawJobs again.`,
    );
    return 1;
  }
  // Another start may be under way right now (at login while you click the shortcut, or an update's
  // new version while the old one exits): only one gets past here, before the data is converted.
  const lock = await takeServerLock(home);
  if (lock === "running") {
    const now = readServerState(home);
    console.log(`RawJobs is already running at http://127.0.0.1:${now?.port ?? DEFAULT_PORT}`);
    if (values.open) openBrowser(`http://127.0.0.1:${now?.port ?? DEFAULT_PORT}`);
    return 0;
  }
  if (lock === "busy") {
    console.error("Another RawJobs server is starting from this folder and hasn't answered yet, so a second one isn't started next to it. Try again in a minute, or restart the computer.");
    return 1;
  }
  // However this process ends (an update stops it, Ctrl+C, an error), the next start can take over.
  process.once("exit", () => lock.release());

  // From here on this version really starts: an update looks for this line to tell "it failed" from "it never ran".
  console.log(`RawJobs ${APP_VERSION} is starting.`);

  const first = Number(values.port ?? process.env.RAWJOBS_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(first) || first < 1 || first > 65535) {
    console.error(`Not a port: ${values.port ?? process.env.RAWJOBS_PORT}`);
    return 2;
  }
  // 4317 (or the port asked for) whenever it's free: the browser keeps your page's state per address,
  // so moving for good to 4318 after one busy start would lose it. When it's taken, the port it had
  // last time comes next, so the address doesn't wander between starts.
  const sticky = !values.port && !process.env.RAWJOBS_PORT && running?.port && running.port !== first ? running.port : null;
  const order = portOrder(first, sticky);

  // After an update, the data is converted to this version's format (backed up just before).
  migrateData(home, dataDir);

  let shutdown: () => void = () => process.exit(0);
  // Busy: a scan the dashboard started, or one the computer's schedule started (it holds data/scan.lock).
  const updater = createUpdater({ home, isBusy: () => api.scanning() || scanLockHeld(dataDir), pauseBackground: () => api.pauseBackground(), exit: () => shutdown() });
  // The "RawJobs isn't running" window and page offer a Start button only when rawjobs://open works here.
  const startLink = () => BUNDLED && startLinkInstalled(home);
  const api = createApi({ home, dataDir, updater, startLink, safeMode: () => safeMode, reveal: (file) => openBrowser(dirname(file)) });
  const pages = { startLink, platform: process.platform };
  const server = createServer(createHandler({ api, roots: [WEB_DIR, dataDir], pages }));
  // A promise nobody awaited that failed (a background task, a timer): logged, not fatal. Node would
  // otherwise end the whole server, and with it the dashboard and scheduled scans.
  process.on("unhandledRejection", (reason) => console.error(`RawJobs: unhandled rejection: ${(reason as Error)?.stack ?? reason}`));

  let port = 0;
  for (const [i, p] of order.entries()) {
    try {
      port = await listen(server, p);
      break;
    } catch (err) {
      // The port from last time may be gone (or refused) for other reasons: just move on.
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" && p !== sticky) throw err;
      if (i + 1 < order.length) console.log(`Port ${p} is in use, trying ${order[i + 1]}…`);
    }
  }
  if (!port) {
    console.error(`Ports ${first}–${first + TRIES - 1} are all in use. Pick another with --port.`);
    return 1;
  }

  // Crashed again and again just now: start without the background work (it runs at every start, so
  // it may be what crashes), and add it once the server has stayed up a while.
  collectReports(logDir, { where: "server", version: APP_VERSION });
  const crashes = recentCrashes(logDir, "server");
  safeMode = crashes >= SAFE_MODE_CRASHES;
  const startWork = () => {
    api.startBackground();
    // A scheduled scan missed while the computer was off or asleep starts once it's back on and online.
    // Installed copies only: a dev server must never start your real scheduled task.
    if (BUNDLED) watchMissedScans({ dataDir, busy: () => api.scanning() || updater.updating(), cli: (args) => api.cli(args) });
  };
  if (safeMode) {
    console.log(`RawJobs restarted after ${crashes} crashes in the last few minutes: starting in safe mode, without background work, for 30 minutes.`);
    setTimeout(() => {
      safeMode = false;
      console.log("Safe mode is over: starting the background work.");
      startWork();
    }, SAFE_MODE_MS).unref();
  } else startWork();
  updater.start();
  // Copies installed before there was a Desktop shortcut (or an icon) get them on this version's first start.
  if (BUNDLED) ensureShortcuts(home, process.env.RAWJOBS_LAUNCHER, APP_VERSION);
  // Copies installed before: the server task at normal priority, and no scheduled task waking the laptop.
  if (BUNDLED) void ensureAutostart(home, APP_VERSION);
  watchEventLoop();
  // Where the shortcut (rawjobs open) finds the dashboard, also when 4317 was taken.
  writeServerState(port, home);
  const url = `http://127.0.0.1:${port}`;
  console.log(`RawJobs ${APP_VERSION} is running at ${url}`);
  console.log(`Your RawJobs folder: ${home}`);
  if (values.open) openBrowser(url);

  return new Promise((done) => {
    // An update stops this server; the old version's helper starts the new one.
    shutdown = () => {
      // Let a running scan save and stop first, so it isn't cut off mid-write.
      void api.stop().finally(() => {
        server.close();
        lock.release();
        done(0);
      });
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown());
  });
}

/** The ports to try, in order: the first choice, then last time's (if different), then the next few. */
export function portOrder(first: number, last: number | null): number[] {
  const next = Array.from({ length: TRIES - 1 }, (_, i) => first + 1 + i).filter((p) => p !== last);
  return [first, ...(last && last !== first ? [last] : []), ...next];
}

function listen(srv: Server, port: number): Promise<number> {
  return new Promise((done, fail) => {
    const onError = (err: NodeJS.ErrnoException) => {
      srv.off("listening", onListening);
      fail(err);
    };
    const onListening = () => {
      srv.off("error", onError);
      done(port);
    };
    srv.once("error", onError);
    srv.once("listening", onListening);
    srv.listen(port, "127.0.0.1");
  });
}
