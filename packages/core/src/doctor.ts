import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statfsSync, statSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { findConfigPath, loadConfig } from "./config";
import { isRunning } from "./pid";
import { readCrashes, recentCrashes, SAFE_MODE_CRASHES } from "./log";
import { telegramSecrets } from "./notify";
import { makeRedactor } from "./redact";
import { APP_VERSION, BUNDLED } from "./runtime";
import { scanLockHolder } from "./scan";
import { overdueScheduledRun, readScheduledRuns, readScheduleSettings, SCHEDULER_FORMAT, SCHEDULER_NAMES } from "./schedule";
import { zipFiles } from "./zip";
import { writeFileAtomic } from "./atomic";

/**
 * `rawjobs doctor`: what's wrong with this copy of RawJobs, in checks with a plain fix each, and a
 * diagnostics file to attach to a GitHub issue. Nothing is uploaded; the file leaves out your
 * profile, resume, tracking, config and jobs, and the text in it is redacted (redact.ts).
 */
export type CheckStatus = "ok" | "warn" | "fail";
export type DoctorCheck = { id: string; status: CheckStatus; title: string; detail?: string };
export type DoctorReport = { version: string; bundled: boolean; node: string; platform: string; at: string; checks: DoctorCheck[] };

export type DoctorOptions = {
  home: string;
  dataDir: string;
  /** Run a program (Windows: read the scheduled task's last result); tests pass a fake. */
  exec?: (cmd: string, args: string[]) => { status: number | null; stdout: string };
  now?: Date;
};

const GB = 1024 ** 3;

/** What Task Scheduler's last result codes mean. */
const TASK_RESULTS: Record<string, string> = {
  "0": "finished",
  "267009": "is running",
  "267011": "hasn't run yet",
  "267014": "was stopped at its time limit",
  "2147750687": "was skipped: it was already running",
  "2147946720": "was skipped: it was already running",
  "1": "exited with an error",
};

export function runDoctor(o: DoctorOptions): DoctorReport {
  const now = o.now ?? new Date();
  const checks: DoctorCheck[] = [];
  const add = (id: string, status: CheckStatus, title: string, detail?: string) => checks.push({ id, status, title, ...(detail ? { detail } : {}) });
  const logDir = join(o.home, "logs");

  try {
    const fs = statfsSync(o.home);
    const free = fs.bavail * fs.bsize;
    add("disk", free < GB ? "warn" : "ok", `${(free / GB).toFixed(1)} GB free on the RawJobs folder's disk`, free < GB ? "Scans and update backups need room: free up some space." : undefined);
  } catch {
    add("disk", "warn", "Couldn't read the free disk space");
  }

  const state = readJson<{ pid?: number; port?: number }>(join(o.home, "state.json"));
  if (!state?.pid) add("server", "warn", "The server hasn't said where it runs (no state.json)", "Start RawJobs from its shortcut.");
  else
    add(
      "server",
      isRunning(state.pid) ? "ok" : "warn",
      isRunning(state.pid) ? `The server runs (process ${state.pid}, port ${state.port})` : "The server isn't running",
      isRunning(state.pid) ? undefined : "Start RawJobs from its shortcut.",
    );

  const crashes = readCrashes(logDir);
  const recent = recentCrashes(logDir, "server", now.getTime());
  if (!crashes.length) add("crashes", "ok", "No crashes recorded");
  else
    add(
      "crashes",
      recent >= SAFE_MODE_CRASHES ? "fail" : "warn",
      `${crashes.length} crash${crashes.length === 1 ? "" : "es"} recorded, the last ${crashes[0]!.at} (${crashes[0]!.where}: ${crashes[0]!.message.slice(0, 120)})`,
      recent >= SAFE_MODE_CRASHES ? "The server keeps crashing, so it started in safe mode. Attach this file to a GitHub issue." : undefined,
    );

  const holder = scanLockHolder(o.dataDir);
  const runs = readScheduledRuns(o.dataDir);
  const overdue = overdueScheduledRun(runs, holder, now.getTime());
  if (overdue) add("scan-lock", "fail", `A scheduled scan from ${overdue.startedAt} still runs, far past its time limit`, "RawJobs stops it by itself within a few minutes while the dashboard runs.");
  else add("scan-lock", "ok", holder ? `A scan is running (process ${holder})` : "No scan is running");

  const settings = readScheduleSettings(o.dataDir);
  if (!settings) add("schedule", "ok", "No scheduled scans");
  else {
    const format = readJson<{ format?: number }>(join(o.dataDir, "scheduler-format.json"))?.format;
    add(
      "schedule",
      format === SCHEDULER_FORMAT ? "ok" : "warn",
      `Scheduled scans at ${settings.times.join(", ")} (${settings.scope})`,
      format === SCHEDULER_FORMAT ? undefined : "Written by an older version: RawJobs writes them again at its next start.",
    );
    const last = runs.filter((r) => r.finishedAt).slice(0, 5);
    const failed = last.filter((r) => !r.ok);
    add("runs", failed.length >= 3 ? "warn" : "ok", `Last ${last.length} scheduled runs: ${last.length - failed.length} finished, ${failed.length} didn't`, failed[0]?.error?.slice(0, 200));
    if (process.platform === "win32") {
      const r = (o.exec ?? defaultExec)("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$i = Get-ScheduledTaskInfo -TaskName '${SCHEDULER_NAMES.task}' -ErrorAction SilentlyContinue; if ($i) { [uint32]$i.LastTaskResult }`,
      ]);
      const code = r.stdout.trim();
      if (code)
        add(
          "task",
          ["267014", "1", "2147750687", "2147946720"].includes(code) ? "warn" : "ok",
          `Windows: the scan task's last run ${TASK_RESULTS[code] ?? `ended with code 0x${Number(code).toString(16)}`}`,
        );
    }
  }

  try {
    const { config } = loadConfig(findConfigPath(o.home));
    add("config", "ok", `Your config reads fine (${config.companies.length} companies)`);
  } catch (err) {
    add("config", "fail", "Your config can't be read", (err as Error).message);
  }
  const tg = telegramSecrets(o.home);
  add("telegram", "ok", tg.token && tg.chatId ? "Telegram is set up" : "Telegram isn't set up");

  return { version: APP_VERSION, bundled: BUNDLED, node: process.version, platform: `${process.platform} ${process.arch}`, at: now.toISOString(), checks };
}

/** Files in the diagnostics zip: [name in the zip, path, at most this many bytes from the end]. */
function zipSources(home: string, dataDir: string): [string, string, number][] {
  const logs = join(home, "logs");
  const fromLogs = (f: string, max: number): [string, string, number] => [`logs/${f}`, join(logs, f), max];
  return [
    fromLogs("server.log", 2_000_000),
    fromLogs("server.log.1", 2_000_000),
    fromLogs("update.log", 1_000_000),
    fromLogs("schedule.log", 1_000_000),
    fromLogs("schedule.log.1", 1_000_000),
    fromLogs("daily-summary.log", 1_000_000),
    fromLogs("launchd-scan.log", 200_000),
    fromLogs("launchd-daily.log", 200_000),
    fromLogs("crashes.json", 200_000),
    ["data/schedule-runs.json", join(dataDir, "schedule-runs.json"), 200_000],
    ["data/schedule.json", join(dataDir, "schedule.json"), 10_000],
    ["data/daily-summary.json", join(dataDir, "daily-summary.json"), 10_000],
    ["data/scheduler-format.json", join(dataDir, "scheduler-format.json"), 1_000],
    ["data/format.json", join(dataDir, "format.json"), 1_000],
    ["data/scan-stats.json", join(dataDir, "scan-stats.json"), 200_000],
    ["app/last-update.json", join(home, "app/last-update.json"), 50_000],
    ["state.json", join(home, "state.json"), 10_000],
    ["autostart.json", join(home, "autostart.json"), 10_000],
  ];
}

/**
 * Write the diagnostics zip (default: logs/rawjobs-doctor-<date>.zip) and say where. Never in it:
 * profile/ (resume, tracking, secrets, connections), your config, jobs, history, descriptions or the
 * company directory. Every text file is redacted; data/ and logs/ are listed by name and size only.
 */
export function writeDoctorZip(o: DoctorOptions & { out?: string; report?: DoctorReport }): { path: string; redacted: Record<string, number> } {
  const report = o.report ?? runDoctor(o);
  let companies: string[] = [];
  try {
    companies = loadConfig(findConfigPath(o.home)).config.companies.flatMap((c) => [c.name, c.slug].filter((s): s is string => !!s));
  } catch {
    // no config: nothing of it to take out
  }
  const { redact, counts } = makeRedactor({ home: o.home, homedir: homedir(), user: safe(() => userInfo().username), host: safe(() => hostname()), companies });
  const entries: { name: string; data: string }[] = [];
  for (const [name, path, max] of zipSources(o.home, o.dataDir)) {
    const text = readTail(path, max);
    if (text !== undefined) entries.push({ name, data: redact(text) });
  }
  const reports = join(o.home, "logs/reports");
  const summaries = listJson(reports).map((f) => {
    const r = readJson<{ header?: { event?: string; trigger?: string; dumpEventTime?: string; nodejsVersion?: string }; javascriptStack?: { message?: string; stack?: string[] } }>(join(reports, f));
    return {
      file: f,
      event: r?.header?.event,
      trigger: r?.header?.trigger,
      at: r?.header?.dumpEventTime,
      node: r?.header?.nodejsVersion,
      message: r?.javascriptStack?.message,
      top: r?.javascriptStack?.stack?.slice(0, 5),
    };
  });
  if (summaries.length) entries.push({ name: "logs/reports/summary.json", data: redact(JSON.stringify(summaries, null, 1)) });
  entries.push({ name: "files.txt", data: redact([...fileList(o.dataDir, "data"), ...fileList(join(o.home, "logs"), "logs")].join("\n")) });
  // Last, so it can say what was taken out of everything above.
  entries.unshift({ name: "doctor.json", data: redact(JSON.stringify({ ...report, redacted: counts }, null, 1)) });
  const out = o.out ?? join(o.home, "logs", `rawjobs-doctor-${(o.now ?? new Date()).toISOString().slice(0, 10)}.zip`);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileAtomic(out, zipFiles(entries));
  return { path: out, redacted: counts };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** The last `max` bytes of a file as text; undefined when it's missing. */
function readTail(path: string, max: number): string | undefined {
  if (!existsSync(path)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = statSync(path).size;
    const start = Math.max(0, size - max);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/** "name  bytes  modified" for each file in a folder (one level), no contents. */
function fileList(dir: string, label: string): string[] {
  try {
    return readdirSync(dir).map((f) => {
      try {
        const s = statSync(join(dir, f));
        return `${label}/${f}${s.isDirectory() ? "/" : ""}  ${s.isDirectory() ? "-" : s.size}  ${s.mtime.toISOString()}`;
      } catch {
        return `${label}/${f}`;
      }
    });
  } catch {
    return [];
  }
}

const safe = (f: () => string): string | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

const defaultExec = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  return { status: r.status, stdout: r.stdout ?? "" };
};
