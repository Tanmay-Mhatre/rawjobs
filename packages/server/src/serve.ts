import { existsSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { parseArgs } from "node:util";
import { defaultDataDir, rawjobsHome } from "@rawjobs/core";
import { APP_VERSION, BUNDLED, migrateData, scanLockHeld, WEB_DIR } from "@rawjobs/core";
import { createApi } from "./api";
import { createUpdater } from "./updater";
import { DEFAULT_PORT, logTo, openBrowser, readServerState, serverRunning, writeServerState } from "./desktop";
import { ensureShortcuts, startLinkInstalled } from "./shortcuts";
import { servePages, serveStatic } from "./static";

const TRIES = 10;

/**
 * The dashboard and its API, without the dev server (`rawjobs serve`, `pnpm start`). Runs until
 * Ctrl+C or the computer's scheduler stops it; a scan that's running saves its progress and can be
 * resumed next time.
 */
export async function serve(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, open: { type: "boolean", default: false }, log: { type: "string" } } });
  if (values.log) logTo(values.log);
  const home = rawjobsHome();
  const dataDir = defaultDataDir(home);
  mkdirSync(dataDir, { recursive: true });
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
  if (!values.port && (await serverRunning(running))) {
    console.log(`RawJobs is already running at http://127.0.0.1:${running!.port}`);
    if (values.open) openBrowser(`http://127.0.0.1:${running!.port}`);
    return 0;
  }

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
  const updater = createUpdater({ home, isBusy: () => api.scanning() || scanLockHeld(dataDir), exit: () => shutdown() });
  // The "RawJobs isn't running" window and page offer a Start button only when rawjobs://open works here.
  const startLink = () => BUNDLED && startLinkInstalled(home);
  const api = createApi({ home, dataDir, updater, startLink });
  const pages = { startLink, platform: process.platform };
  const server = createServer((req, res) => {
    void api.handle(req, res).then((handled) => {
      if (handled || serveStatic([WEB_DIR, dataDir], req, res)) return;
      servePages(req, res, pages);
    });
  });

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

  api.startBackground();
  updater.start();
  // Copies installed before there was a Desktop shortcut (or an icon) get them on this version's first start.
  if (BUNDLED) ensureShortcuts(home, process.env.RAWJOBS_LAUNCHER, APP_VERSION);
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
