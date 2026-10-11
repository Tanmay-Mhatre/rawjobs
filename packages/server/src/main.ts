import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultDataDir } from "../../core/src/paths";
import { createApi } from "./api";
import { serveStatic } from "./static";

/**
 * The dashboard without the dev server: `pnpm start` builds the web app and serves it with the API
 * on http://127.0.0.1:4317. Only this computer can reach it.
 *   --port <n>   start here (default 4317, or RAWJOBS_PORT); the next free port is used if it's taken
 *   --open       open the dashboard in your browser once it's up
 */
const DEFAULT_PORT = 4317;
const TRIES = 10;

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    open: { type: "boolean", default: false },
  },
});

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
/** Your RawJobs folder (RAWJOBS_HOME), else this checkout, as before. */
const home = process.env.RAWJOBS_HOME ? resolve(process.env.RAWJOBS_HOME) : repoRoot;
const dataDir = defaultDataDir(home);
const webDist = resolve(repoRoot, "apps/web/dist");
mkdirSync(dataDir, { recursive: true });
if (!existsSync(resolve(webDist, "index.html"))) {
  console.error("The dashboard isn't built yet. Run `pnpm build` first (or `pnpm start`, which builds it).");
  process.exit(1);
}

const api = createApi({ repoRoot, home, dataDir });
const server = createServer((req, res) => {
  void api.handle(req, res).then((handled) => {
    if (handled || serveStatic([webDist, dataDir], req, res)) return;
    res.statusCode = 404;
    res.end("Not found");
  });
});

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

const first = Number(values.port ?? process.env.RAWJOBS_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(first) || first < 1 || first > 65535) {
  console.error(`Not a port: ${values.port ?? process.env.RAWJOBS_PORT}`);
  process.exit(1);
}

let port = 0;
for (let p = first; p < first + TRIES && !port; p++) {
  try {
    port = await listen(server, p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    console.log(`Port ${p} is in use, trying ${p + 1}…`);
  }
}
if (!port) {
  console.error(`Ports ${first}–${first + TRIES - 1} are all in use. Pick another with --port.`);
  process.exit(1);
}

api.startBackground();
const url = `http://127.0.0.1:${port}`;
console.log(`RawJobs ${api.version} is running at ${url}`);
if (port !== DEFAULT_PORT) console.log(`(Not on ${DEFAULT_PORT}: statuses and notes saved in your browser are kept per address.)`);
if (values.open) openBrowser(url);

function openBrowser(target: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

// Ctrl+C: stop listening; a scan that's running saves its progress and can be resumed next time.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
