import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { parseArgs } from "node:util";
import { defaultDataDir, rawjobsHome } from "../../core/src/paths";
import { APP_VERSION, BUNDLED, WEB_DIR } from "../../core/src/runtime";
import { createApi } from "./api";
import { serveStatic } from "./static";

export const DEFAULT_PORT = 4317;
const TRIES = 10;

export const SERVE_HELP = `rawjobs serve [--port <n>] [--open]
  Run the dashboard on http://127.0.0.1:4317 (only this computer can reach it).
  --port <n>   start here (default 4317, or RAWJOBS_PORT); the next free port is used if it's taken
  --open       open the dashboard in your browser once it's up`;

/**
 * The dashboard and its API, without the dev server (`rawjobs serve`, `pnpm start`). Runs until
 * Ctrl+C or the computer's scheduler stops it; a scan that's running saves its progress and can be
 * resumed next time.
 */
export async function serve(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, open: { type: "boolean", default: false } } });
  const home = rawjobsHome();
  const dataDir = defaultDataDir(home);
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(`${WEB_DIR}/index.html`)) {
    console.error(BUNDLED ? `This copy of RawJobs is missing its dashboard (${WEB_DIR}). Run the install line again to repair it.` : "The dashboard isn't built yet. Run `pnpm build` first (or `pnpm start`, which builds it).");
    return 1;
  }

  const first = Number(values.port ?? process.env.RAWJOBS_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(first) || first < 1 || first > 65535) {
    console.error(`Not a port: ${values.port ?? process.env.RAWJOBS_PORT}`);
    return 2;
  }

  const api = createApi({ home, dataDir });
  const server = createServer((req, res) => {
    void api.handle(req, res).then((handled) => {
      if (handled || serveStatic([WEB_DIR, dataDir], req, res)) return;
      res.statusCode = 404;
      res.end("Not found");
    });
  });

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
    return 1;
  }

  api.startBackground();
  const url = `http://127.0.0.1:${port}`;
  console.log(`RawJobs ${APP_VERSION} is running at ${url}`);
  console.log(`Your RawJobs folder: ${home}`);
  if (values.open) openBrowser(url);

  return new Promise((done) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        server.close();
        done(0);
      });
    }
  });
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

function openBrowser(target: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}
