import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ScanScope } from "./scope";
import { writeFileAtomic } from "./atomic";

/**
 * Scheduled scans on this computer: the operating system's own scheduler runs
 * `rawjobs scan --scope <type> --notify --scheduled` at the times you pick, even with the
 * dashboard closed. It only runs while the computer is on (or asleep: Windows wakes it); a scan
 * missed while it was off runs as soon as it's back on.
 */

export type ScheduleSettings = { times: string[]; scope: ScanScope };
export type ScheduledRun = {
  startedAt: string;
  finishedAt?: string;
  scope: ScanScope;
  ok: boolean;
  matches?: number;
  newMatches?: number;
  /** Telegram: sent, nothing new, not set up, or why it failed. */
  notified?: "sent" | "nothing-new" | "off" | string;
  stopped?: boolean;
  error?: string;
};
export type ScheduleStatus = {
  installed: boolean;
  supported: boolean;
  platform: NodeJS.Platform;
  settings?: ScheduleSettings;
  nextRun?: string;
  lastRun?: ScheduledRun;
  runs: ScheduledRun[];
  /** Why it isn't installed or doesn't work, in plain words. */
  problem?: string;
};

/** What the scheduled scan is called in each operating system's scheduler. */
export type SchedulerNames = { task: string; label: string; unit: string };
export const SCHEDULER_NAMES: SchedulerNames = { task: "RawJobs Scan", label: "com.rawjobs.scan", unit: "rawjobs-scan" };
/** The names from before the rename to RawJobs: still found by status and "run now", removed on save or turn off. */
export const LEGACY_SCHEDULER_NAMES: SchedulerNames = { task: "JobHunter Scan", label: "com.jobhunter.scan", unit: "jobhunter-scan" };
const SETTINGS_FILE = "schedule.json";
const RUNS_FILE = "schedule-runs.json";
const KEEP_RUNS = 30;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateSchedule(s: Partial<ScheduleSettings>): ScheduleSettings {
  const times = [...new Set(s.times ?? [])].sort();
  if (!times.length || times.length > 4) throw new Error("Pick one to four times a day.");
  for (const t of times) if (!TIME.test(t)) throw new Error(`"${t}" isn't a time like 08:00.`);
  if (s.scope !== "mine" && s.scope !== "all") throw new Error('Scope must be "mine" or "all".');
  return { times, scope: s.scope };
}

// ---------- run log (written by the scheduled scan itself) ----------

export function readScheduledRuns(dataDir: string): ScheduledRun[] {
  try {
    return JSON.parse(readFileSync(join(dataDir, RUNS_FILE), "utf8")) as ScheduledRun[];
  } catch {
    return [];
  }
}

export function recordScheduledRun(dataDir: string, run: ScheduledRun): void {
  const runs = [run, ...readScheduledRuns(dataDir).filter((r) => r.startedAt !== run.startedAt)].slice(0, KEEP_RUNS);
  mkdirSync(dataDir, { recursive: true });
  writeFileAtomic(join(dataDir, RUNS_FILE), JSON.stringify(runs, null, 1));
}

// ---------- the command the scheduler runs ----------

export type ScheduleContext = {
  /** Where RawJobs' code is (node_modules/tsx and the CLI). */
  repoRoot: string;
  /** Your RawJobs folder: the scan runs from here, so it finds your config and resume. Default: repoRoot. */
  workDir?: string;
  /** How the scheduler starts the CLI (runtime's schedulerCommand()). Default: node + tsx + the sources in repoRoot. */
  launch?: { command: string; args: string[] };
  dataDir: string;
  /** Run a program; tests pass a fake. */
  exec?: (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
  platform?: NodeJS.Platform;
  home?: string;
};

const defaultExec = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error) : "") };
};

const workDir = (ctx: ScheduleContext) => resolve(ctx.workDir ?? ctx.repoRoot);

/** The scan command, with absolute paths (the scheduler starts with no PATH or working folder of ours). */
export function scanCommand(ctx: ScheduleContext, scope: ScanScope): string[] {
  const launch = ctx.launch ?? {
    command: process.execPath,
    args: [resolve(ctx.repoRoot, "node_modules/tsx/dist/cli.mjs"), resolve(ctx.repoRoot, "packages/cli/src/index.ts")],
  };
  return [
    launch.command,
    ...launch.args,
    "scan",
    "--scope",
    scope,
    "--notify",
    "--scheduled",
    "--data",
    resolve(ctx.dataDir),
  ];
}

/** Hours a scan may run before the scheduler stops it: "all" takes about 2 h. */
const timeLimitHours = (scope: ScanScope) => (scope === "all" ? 4 : 1);

// ---------- Windows: Task Scheduler ----------

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** A command line argument, quoted for Windows. */
const winArg = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

function powershell(ctx: ScheduleContext, script: string) {
  return (ctx.exec ?? defaultExec)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

function installWindows(ctx: ScheduleContext, s: ScheduleSettings, n: SchedulerNames): void {
  const [exe, ...args] = scanCommand(ctx, s.scope);
  // conhost --headless: run without flashing a console window on the desktop.
  const argument = ["--headless", exe!, ...args].map(winArg).join(" ");
  const triggers = s.times.map((t) => `(New-ScheduledTaskTrigger -Daily -At ${psq(t)})`).join(",");
  const script = [
    `$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ${psq(argument)} -WorkingDirectory ${psq(workDir(ctx))}`,
    `$t = @(${triggers})`,
    // StartWhenAvailable: a scan missed while the PC was off runs once it's back on. WakeToRun: wake from sleep.
    `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours ${timeLimitHours(s.scope)})`,
    `Register-ScheduledTask -TaskName ${psq(n.task)} -Action $a -Trigger $t -Settings $s -Description 'RawJobs: sync the company directory, scan, and send new jobs to Telegram.' -Force | Out-Null`,
  ].join("; ");
  const r = powershell(ctx, script);
  if (r.status !== 0) throw new Error(`Windows Task Scheduler refused the schedule: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
}

function removeWindows(ctx: ScheduleContext, n: SchedulerNames): void {
  powershell(ctx, `Unregister-ScheduledTask -TaskName ${psq(n.task)} -Confirm:$false -ErrorAction SilentlyContinue`);
}

function statusWindows(ctx: ScheduleContext, n: SchedulerNames): { installed: boolean; nextRun?: string } {
  const r = powershell(
    ctx,
    `$t = Get-ScheduledTask -TaskName ${psq(n.task)} -ErrorAction SilentlyContinue; if ($t) { $i = $t | Get-ScheduledTaskInfo; @{ next = if ($i.NextRunTime) { $i.NextRunTime.ToUniversalTime().ToString('o') } else { $null } } | ConvertTo-Json -Compress }`,
  );
  const out = r.stdout.trim();
  if (!out) return { installed: false };
  try {
    const j = JSON.parse(out) as { next?: string | null };
    return { installed: true, nextRun: j.next ?? undefined };
  } catch {
    return { installed: true };
  }
}

// ---------- macOS: launchd ----------

const plistPath = (ctx: ScheduleContext, n: SchedulerNames) => join(ctx.home ?? homedir(), "Library/LaunchAgents", `${n.label}.plist`);
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function installMac(ctx: ScheduleContext, s: ScheduleSettings, n: SchedulerNames): void {
  const args = scanCommand(ctx, s.scope).map((a) => `    <string>${xml(a)}</string>`).join("\n");
  const times = s.times
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
    })
    .join("\n");
  const log = xml(join(resolve(ctx.dataDir), "schedule.log"));
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${n.label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xml(workDir(ctx))}</string>
  <key>StartCalendarInterval</key>
  <array>
${times}
  </array>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
  const path = plistPath(ctx, n);
  mkdirSync(dirname(path), { recursive: true });
  const exec = ctx.exec ?? defaultExec;
  exec("launchctl", ["unload", path]);
  writeFileSync(path, plist);
  const r = exec("launchctl", ["load", "-w", path]);
  if (r.status !== 0) throw new Error(`launchd refused the schedule: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
}

function removeMac(ctx: ScheduleContext, n: SchedulerNames): void {
  const path = plistPath(ctx, n);
  if (!existsSync(path)) return;
  (ctx.exec ?? defaultExec)("launchctl", ["unload", path]);
  rmSync(path, { force: true });
}

// ---------- Linux: systemd user timer ----------

const unitDir = (ctx: ScheduleContext) => join(ctx.home ?? homedir(), ".config/systemd/user");

function installLinux(ctx: ScheduleContext, s: ScheduleSettings, n: SchedulerNames): void {
  const exec = ctx.exec ?? defaultExec;
  if (exec("systemctl", ["--user", "--version"]).status !== 0) throw new Error("This system has no systemd user session. Add a cron line instead: see the README.");
  const dir = unitDir(ctx);
  mkdirSync(dir, { recursive: true });
  const cmd = scanCommand(ctx, s.scope)
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(" ");
  writeFileSync(
    join(dir, `${n.unit}.service`),
    `[Unit]\nDescription=RawJobs scan\n\n[Service]\nType=oneshot\nWorkingDirectory=${workDir(ctx)}\nExecStart=${cmd}\nTimeoutStartSec=${timeLimitHours(s.scope)}h\n`,
  );
  // Persistent: a run missed while the computer was off happens at the next boot.
  writeFileSync(join(dir, `${n.unit}.timer`), `[Unit]\nDescription=RawJobs scan\n\n[Timer]\n${s.times.map((t) => `OnCalendar=*-*-* ${t}:00`).join("\n")}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`);
  exec("systemctl", ["--user", "daemon-reload"]);
  const r = exec("systemctl", ["--user", "enable", "--now", `${n.unit}.timer`]);
  if (r.status !== 0) throw new Error(`systemd refused the schedule: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
}

function removeLinux(ctx: ScheduleContext, n: SchedulerNames): void {
  const exec = ctx.exec ?? defaultExec;
  exec("systemctl", ["--user", "disable", "--now", `${n.unit}.timer`]);
  for (const ext of ["service", "timer"]) rmSync(join(unitDir(ctx), `${n.unit}.${ext}`), { force: true });
  exec("systemctl", ["--user", "daemon-reload"]);
}

// ---------- the public API ----------

/** The next time one of these daily times comes round (local time), as ISO. */
export function nextRunAt(times: readonly string[], now = new Date()): string | undefined {
  const candidates = times.flatMap((t) => {
    const [h, m] = t.split(":").map(Number);
    const today = new Date(now);
    today.setHours(h!, m!, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    return [today, tomorrow].filter((d) => d > now);
  });
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString();
}

function removeFrom(ctx: ScheduleContext, platform: NodeJS.Platform, n: SchedulerNames): void {
  if (platform === "win32") removeWindows(ctx, n);
  else if (platform === "darwin") removeMac(ctx, n);
  else if (platform === "linux") removeLinux(ctx, n);
}

/** Whether the scheduler has an entry under these names (and, on Windows, its next run). */
function installedAs(ctx: ScheduleContext, platform: NodeJS.Platform, n: SchedulerNames): { installed: boolean; nextRun?: string } {
  if (platform === "win32") return statusWindows(ctx, n);
  if (platform === "darwin") return { installed: existsSync(plistPath(ctx, n)) };
  if (platform === "linux") return { installed: existsSync(join(unitDir(ctx), `${n.unit}.timer`)) };
  return { installed: false };
}

/** The names the schedule is installed under: the current ones, or the pre-rename ones until it's saved again. */
function activeNames(ctx: ScheduleContext, platform: NodeJS.Platform): { names: SchedulerNames; installed: boolean; nextRun?: string } {
  const current = installedAs(ctx, platform, SCHEDULER_NAMES);
  if (current.installed) return { names: SCHEDULER_NAMES, ...current };
  const legacy = installedAs(ctx, platform, LEGACY_SCHEDULER_NAMES);
  return legacy.installed ? { names: LEGACY_SCHEDULER_NAMES, ...legacy } : { names: SCHEDULER_NAMES, ...current };
}

export function installSchedule(ctx: ScheduleContext, input: Partial<ScheduleSettings>): ScheduleSettings {
  const s = validateSchedule(input);
  const platform = ctx.platform ?? process.platform;
  if (platform === "win32") installWindows(ctx, s, SCHEDULER_NAMES);
  else if (platform === "darwin") installMac(ctx, s, SCHEDULER_NAMES);
  else if (platform === "linux") installLinux(ctx, s, SCHEDULER_NAMES);
  else throw new Error(`Scheduled scans aren't supported on ${platform} yet.`);
  // A schedule saved before the rename would otherwise scan twice.
  removeFrom(ctx, platform, LEGACY_SCHEDULER_NAMES);
  mkdirSync(ctx.dataDir, { recursive: true });
  writeFileAtomic(join(ctx.dataDir, SETTINGS_FILE), JSON.stringify(s, null, 1));
  return s;
}

export function removeSchedule(ctx: ScheduleContext): void {
  const platform = ctx.platform ?? process.platform;
  removeFrom(ctx, platform, SCHEDULER_NAMES);
  removeFrom(ctx, platform, LEGACY_SCHEDULER_NAMES);
  rmSync(join(ctx.dataDir, SETTINGS_FILE), { force: true });
}

/** Start the scheduled scan now, the way the scheduler would (to try it out). */
export function runScheduleNow(ctx: ScheduleContext): void {
  const platform = ctx.platform ?? process.platform;
  const exec = ctx.exec ?? defaultExec;
  const n = activeNames(ctx, platform).names;
  const r =
    platform === "win32"
      ? powershell(ctx, `Start-ScheduledTask -TaskName ${psq(n.task)}`)
      : platform === "darwin"
        ? exec("launchctl", ["start", n.label])
        : exec("systemctl", ["--user", "start", "--no-block", `${n.unit}.service`]);
  if (r.status !== 0) throw new Error(`Couldn't start the scheduled scan: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
}

export function scheduleStatus(ctx: ScheduleContext, now = new Date()): ScheduleStatus {
  const platform = ctx.platform ?? process.platform;
  const supported = platform === "win32" || platform === "darwin" || platform === "linux";
  let settings: ScheduleSettings | undefined;
  try {
    settings = JSON.parse(readFileSync(join(ctx.dataDir, SETTINGS_FILE), "utf8")) as ScheduleSettings;
  } catch {
    settings = undefined;
  }
  const runs = readScheduledRuns(ctx.dataDir);
  let installed = !!settings;
  let nextRun = settings ? nextRunAt(settings.times, now) : undefined;
  let problem: string | undefined;
  if (supported && settings) {
    const a = activeNames(ctx, platform);
    installed = a.installed;
    nextRun = a.nextRun ?? nextRun;
    if (platform === "win32" && !a.installed) problem = "The scheduled task is missing from Windows Task Scheduler. Save the schedule again to recreate it.";
  }
  return { installed, supported, platform, settings, nextRun: installed ? nextRun : undefined, lastRun: runs[0], runs, ...(problem ? { problem } : {}) };
}
