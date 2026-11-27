#!/usr/bin/env -S npx tsx
import { resolve } from "node:path";
import { APP_VERSION, ConfigError, type Log, openLog, recordCrash, teeConsole } from "@rawjobs/core";
import { cmdCompanies } from "./commands/companies";
import { cmdRun } from "./commands/run";
import { cmdAlerts } from "./commands/alerts";
import { cmdSchedule } from "./commands/schedule";
import { cmdToday } from "./commands/today";
import { cmdDirectory } from "./commands/directory";
import { cmdSetup } from "./commands/setup";
import { cmdDetect, cmdValidate } from "./commands/check";
import { cmdDoctor } from "./commands/doctor";

const HELP = `RawJobs: self-hosted job radar

Usage:
  rawjobs serve [--port <n>] [--open] [--log <file>]   Run the dashboard on http://127.0.0.1:4317
  rawjobs open                Open the dashboard (starting it if it isn't running)
  rawjobs update [--check] [--to <version>]   Install the newest version now (an installed copy)
  rawjobs uninstall [--keep-data|--delete-data]   Remove an installed copy (your data is kept unless you say)
  rawjobs shortcuts [--desktop]   Make or repair the RawJobs shortcut (--desktop: also on the Desktop)
  rawjobs scan [options]      Sync the directory, fetch your companies (and more, by scope) live, score them
  rawjobs schedule <status|install|remove>   Scan on a schedule on this computer (--time 08:00 [--time 20:00] [--scope mine|yours|all], default mine)
  rawjobs alerts telegram <status|token|connect|test|on|off|forget>   Telegram alerts
  rawjobs today [--notify] [--test]   What's due in your Pipeline today (--notify: send it to Telegram, once a day)
  rawjobs today <status|install|remove> [--time 09:00]   Send it every morning at a time you pick
  rawjobs detect <url>...     Turn careers URLs into config lines
  rawjobs validate            Check your config file
  rawjobs doctor [--json] [--zip [file]]   Check this copy of RawJobs; --zip saves a redacted diagnostics file (nothing is uploaded)
  rawjobs setup <status|save|check>   Used by the dashboard's setup wizard (JSON in/out)
  rawjobs companies suggest   Companies from the directory that fit your profile (industries, roles, places)
  rawjobs directory <status|update|share|search>   The shared company directory: download the latest, share additions

Options for companies suggest:
  -c, --config <path>   Config file (as for run)
  -d, --data <dir>      Where data/catalog/index.json lives (default: data)
  -n, --limit <n>       How many to suggest (default 30)
      --json            Print JSON (used by the dashboard)
      --stdin           Read {"profile"?, "watched"?: ["ats:slug"], "hidden"?: ["ats:slug"]} from stdin (the profile being edited, companies to leave out)

Options for scan (alias: run):
  -s, --scope <type>    mine:  Scan now: your companies, past matches and the shared job feed's picks (default),
                               then a quiet background check of every other company (Settings > Scans)
                        yours: only your companies
                        all:   your companies + every company in the directory
      --no-background   After a mine scan, skip the background check of every other company
      --offline         Don't sync the company directory first
      --full            Fetch every directory company live (don't let the shared job feed skip any)
      --fresh           Start over instead of resuming a stopped scan (Ctrl+C stops and saves progress)
      --plan            Print what each scope covers (companies, minutes) as JSON
      --notify          Send the new jobs to Telegram (when set up in Settings → Alerts)
  -c, --config <path>   Config file (default: rawjobs.config.local.yaml, then rawjobs.config.yaml)
  -o, --only <name>     Only this company (name or slug); repeatable
  -a, --all             Also list jobs that failed the title/location gates
  -n, --limit <n>       Max jobs to print (default 50)
  -d, --data <dir>      Where history is kept for the dashboard (default: data)
      --dry-run         Don't save anything
      --deadline <min>  Stop (progress saved) after this many minutes, or at an ISO time; scheduled scans get one

Any command but serve also takes --log <file>: its output and any crash go to that file too (rotated at 2 MB).
      --json <path>     Also write this run's raw result as JSON
      --progress ndjson Print one JSON line per event instead of the report (for the dashboard)
`;

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

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
    case "scan":
      return cmdRun(rest);
    case "detect":
      return cmdDetect(rest);
    case "doctor":
      return cmdDoctor(rest);
    case "validate":
      return cmdValidate(rest);
    case "setup":
      return cmdSetup(rest);
    case "companies":
      return cmdCompanies(rest);
    case "directory":
      return cmdDirectory(rest);
    case "alerts":
      return cmdAlerts(rest);
    case "schedule":
      return cmdSchedule(rest);
    case "today":
      return cmdToday(rest);
    case "serve":
      // Loaded only when asked for, so other commands start as fast as before.
      return (await import("@rawjobs/server/serve")).serve(rest);
    case "open":
      return (await import("@rawjobs/server/desktop")).openDashboard(rest);
    case "uninstall":
      return (await import("@rawjobs/server/desktop")).uninstall(rest);
    case "update":
      return (await import("@rawjobs/server/desktop")).updateCommand(rest);
    case "shortcuts":
      return (await import("@rawjobs/server/desktop")).shortcutsCommand(rest);
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      return 2;
  }
}

// Output nobody can read any more (a scheduled scan whose console wrapper the scheduler ended, or a
// server that went away) is dropped: without this, the next write's EPIPE would end the process
// wherever it was, a save included. A scan stops through its own checks instead (stopSignal).
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});

const { argv } = takeLog(process.argv.slice(2));

main(argv).then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof ConfigError || (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error((err as Error).message);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  },
);
