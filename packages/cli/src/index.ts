#!/usr/bin/env -S npx tsx
import { resolve } from "node:path";
import { APP_VERSION, type Log, openLog, recordCrash, teeConsole } from "@rawjobs/core";
import { runCli } from "./main";

/**
 * `--log <file>` (any command but serve, which has its own): output and crashes go to that rotating
 * file too. The scheduler passes it, since on Windows a scheduled run's console is thrown away.
 */
function takeLog(argv: string[]): { argv: string[]; log?: Log } {
  const i = argv.indexOf("--log");
  if (argv[0] === "serve" || i < 0 || argv[i + 1] === undefined) return { argv };
  const file = resolve(argv[i + 1]!);
  const log = openLog(file, { maxBytes: 2_000_000 });
  teeConsole(log);
  log.write(`rawjobs ${argv[0] ?? ""} (RawJobs ${APP_VERSION}) started.`);
  process.on("uncaughtExceptionMonitor", (err, origin) => recordCrash(resolve(file, ".."), err, { origin, where: argv[0] ?? "cli", version: APP_VERSION, log }));
  return { argv: [...argv.slice(0, i), ...argv.slice(i + 2)], log };
}

// Output nobody can read any more (a scheduled scan whose console wrapper the scheduler ended, or a
// server that went away) is dropped: without this, the next write's EPIPE would end the process
// wherever it was, a save included. A scan stops through its own checks instead (stopSignal).
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});

const { argv } = takeLog(process.argv.slice(2));

runCli(argv).then((code) => process.exit(code));
