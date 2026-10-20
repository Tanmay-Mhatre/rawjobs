import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { defaultDataDir, rawjobsHome } from "@rawjobs/core";
import { APP_VERSION, BUNDLED, CODE_ROOT, cliCommand } from "@rawjobs/core";
import { removeDailySummary, removeSchedule } from "@rawjobs/core";
import { scanLockHeld } from "@rawjobs/core";
import { compareVersions } from "@rawjobs/core/release";
import { AUTOSTART, fetchManifest, finishPendingUpdate, installedVersions, judge, readLastUpdate, readUpdateFile, releaseBase, releaseBaseFor, startUpdate } from "@rawjobs/core/update";
import { makeShortcuts, removeShortcuts } from "./shortcuts";

/**
 * The parts of an installed copy that live outside the code: the server's state file, its log, how
 * it starts at login, and the shortcut. packaging/install.sh and install.ps1 create the same names.
 */
export { AUTOSTART } from "@rawjobs/core/update";
export const DEFAULT_PORT = 4317;

/** What the running server wrote about itself (RAWJOBS_HOME/state.json). */
export type ServerState = { port: number; pid: number; version: string; startedAt: string };
const statePath = (home: string) => join(home, "state.json");

export function readServerState(home = rawjobsHome()): ServerState | null {
  try {
    return JSON.parse(readFileSync(statePath(home), "utf8")) as ServerState;
  } catch {
    return null;
  }
}

export function writeServerState(port: number, home = rawjobsHome()): void {
  const state: ServerState = { port, pid: process.pid, version: APP_VERSION, startedAt: new Date().toISOString() };
  writeFileSync(statePath(home), `${JSON.stringify(state, null, 1)}\n`);
}

/** Send this process's output to a log file too (kept under 5 MB: the old one moves to .1). */
export function logTo(file: string): void {
  mkdirSync(resolve(file, ".."), { recursive: true });
  try {
    if (statSync(file).size > 5_000_000) renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      try {
        appendFileSync(file, `${new Date().toISOString()} ${String(chunk)}`);
      } catch {
        // a full disk shouldn't stop the server
      }
      return (write as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
  }
}

export function openBrowser(target: string) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true })
    .on("error", () => {})
    .unref();
}

/** A RawJobs server answers at this address. */
export async function healthy(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether this folder's server (state.json) is running. A busy one (a big scan) can be slow to
 * answer: while its process is still there, it gets several tries over about 20 seconds before
 * another one starts next to it on the next port (two servers made an update start the new version
 * into the old one's port, and go back).
 */
export async function serverRunning(state: ServerState | null, o: { tries?: number; timeoutMs?: number; pauseMs?: number } = {}): Promise<boolean> {
  if (!state?.port) return false;
  const url = `http://127.0.0.1:${state.port}`;
  if (await healthy(url)) return true;
  if (!state.pid || state.pid === process.pid || !processAlive(state.pid)) return false;
  for (let i = 0; i < (o.tries ?? 3); i++) {
    await sleep(o.pauseMs ?? 1000);
    if (await healthy(url, o.timeoutMs ?? 5000)) return true;
    if (!processAlive(state.pid)) return false;
  }
  return false;
}

/**
 * `rawjobs open` (the RawJobs shortcut): open the dashboard, starting the server first when it isn't
 * running (it normally is: the computer starts it at login).
 *   --no-browser   only make sure the server is running, and print its address
 */
export async function openDashboard(args: string[]): Promise<number> {
  // A rawjobs://open link passes its URL along (Linux's %u): it's ignored.
  const { values } = parseArgs({ args, options: { "no-browser": { type: "boolean", default: false } }, allowPositionals: true });
  const home = rawjobsHome();
  const known = () => `http://127.0.0.1:${readServerState(home)?.port ?? DEFAULT_PORT}`;
  let url = known();
  if (!(await healthy(url))) {
    // This copy's own CLI, on the Node it runs on; RAWJOBS_HOME (and the launcher's path) carry over.
    const how = cliCommand();
    const child = spawn(how.command, [...how.args, "serve", "--log", join(home, "logs/server.log")], { cwd: home, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(500);
      url = known();
      up = await healthy(url);
    }
    if (!up) {
      console.error(`RawJobs didn't start. See ${join(home, "logs/server.log")}.`);
      return 1;
    }
  }
  console.log(url);
  if (!values["no-browser"]) openBrowser(url);
  return 0;
}

/** Run a program, quietly; tests and other platforms just get a failed status. */
function quiet(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { stdio: "ignore", windowsHide: true });
}

/**
 * `rawjobs uninstall`: remove an installed copy. Stops the server, takes it out of start-at-login,
 * removes scheduled scans and the shortcut, then the program files. Your config, profile/ (resume,
 * tracking, secrets) and data/ are kept unless you say otherwise.
 *   --delete-data   delete them too (asked when not given and this is a terminal)
 *   --keep-data     keep them without asking
 */
export async function uninstall(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { "delete-data": { type: "boolean", default: false }, "keep-data": { type: "boolean", default: false } } });
  const home = rawjobsHome();
  if (!BUNDLED || !process.env.RAWJOBS_LAUNCHER) {
    console.error("This is a copy of the RawJobs source, not an installed one: there's nothing to uninstall. Delete the folder to remove it.");
    return 2;
  }
  let deleteData = values["delete-data"];
  if (!deleteData && !values["keep-data"] && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    deleteData = /^y/i.test(await rl.question(`Also delete your profile, resume, tracking and scan data in ${home}? [y/N] `));
    rl.close();
  }

  try {
    removeSchedule({ repoRoot: CODE_ROOT, workDir: home, dataDir: defaultDataDir(home) });
  } catch {
    // no scheduled scans
  }
  try {
    removeDailySummary({ repoRoot: CODE_ROOT, workDir: home, dataDir: defaultDataDir(home) });
  } catch {
    // no daily summary
  }

  const state = readServerState(home);
  if (process.platform === "win32") {
    quiet("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Unregister-ScheduledTask -TaskName '${AUTOSTART.windowsTask}' -Confirm:$false -ErrorAction SilentlyContinue`,
    ]);
  } else if (process.platform === "darwin") {
    const uid = process.getuid?.() ?? 501;
    quiet("launchctl", ["bootout", `gui/${uid}/${AUTOSTART.macLabel}`]);
    rmSync(join(homedir(), "Library/LaunchAgents", `${AUTOSTART.macLabel}.plist`), { force: true });
  } else {
    quiet("systemctl", ["--user", "disable", "--now", AUTOSTART.linuxUnit]);
    rmSync(join(homedir(), ".config/systemd/user", AUTOSTART.linuxUnit), { force: true });
    quiet("systemctl", ["--user", "daemon-reload"]);
  }
  removeShortcuts(home);
  if (state && state.pid !== process.pid) {
    try {
      process.kill(state.pid);
    } catch {
      // already stopped
    }
  }

  const program = ["app", "runtime", "bin", "logs", "icons", "state.json", "updates.json", "shortcuts.json"];
  const data = ["rawjobs.config.local.yaml", "rawjobs.config.local.backup.yaml", "profile", "data", "backups"];
  const targets = (deleteData ? [...program, ...data] : program).map((p) => join(home, p));
  if (process.platform === "win32") {
    // This very uninstall runs on runtime\…\node.exe, which Windows won't delete while it runs: a
    // small cleanup finishes the job a moment after we exit.
    // No if/else here: cmd folds everything after "else (…) &" into the else branch.
    const del = targets.map((t) => `rmdir /s /q "${t}" 2>nul & del /f /q "${t}" 2>nul`).join(" & ");
    const tail = deleteData ? ` & rmdir "${home}" 2>nul` : "";
    spawn("cmd.exe", ["/d", "/c", `ping -n 3 127.0.0.1 >nul & ${del}${tail}`], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }).unref();
  } else {
    for (const t of targets) rmSync(t, { recursive: true, force: true });
    if (deleteData) rmSync(home, { recursive: true, force: true });
  }
  console.log(deleteData ? `RawJobs is uninstalled, and ${home} is deleted.` : `RawJobs is uninstalled. Your profile, tracking and scan data are still in ${home}.`);
  return 0;
}

/**
 * `rawjobs update`: install the newest version now (an installed copy; the dashboard's Update now
 * does the same). Nothing installs without you asking.
 *   --check      only say whether a newer version is out
 *   --to <v>     install this version, also an older one
 *   --finish     (used by an update itself) start the new version, and go back if it doesn't answer
 */
export async function updateCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { check: { type: "boolean", default: false }, to: { type: "string" }, finish: { type: "boolean", default: false } } });
  const home = rawjobsHome();
  if (values.finish) {
    logTo(join(home, "logs/update.log"));
    const r = await finishPendingUpdate(home);
    return r?.ok === false ? 1 : 0;
  }
  if (!BUNDLED || !process.env.RAWJOBS_LAUNCHER || !installedVersions(home)) {
    console.error("This is a copy of the RawJobs source: update it with git pull (then pnpm install).");
    return 2;
  }
  const settings = readUpdateFile(home);
  const base = values.to ? releaseBaseFor(values.to) : await releaseBase(settings.channel);
  const m = await fetchManifest(base);
  if (values.to && m.version !== values.to.replace(/^v/, "")) {
    console.error(`${base} has version ${m.version}, not ${values.to}.`);
    return 1;
  }
  const c = judge(APP_VERSION, m, values.to ? [] : settings.skip);
  if (values.check || (!values.to && !c.available)) {
    if (c.available) console.log(`RawJobs ${m.version} is out (you have ${APP_VERSION}). Run: rawjobs update`);
    else if (compareVersions(m.version, APP_VERSION) > 0)
      console.log(`RawJobs ${m.version} didn't start here before, so it isn't installed automatically. Install it with: rawjobs update --to ${m.version}`);
    else console.log(`RawJobs ${APP_VERSION} is the newest version.`);
    if (c.tooOld) console.log("This version is too old to update by itself: run the install line again.");
    return 0;
  }
  if (m.version === APP_VERSION) {
    console.log(`RawJobs ${APP_VERSION} is already installed.`);
    return 0;
  }
  if (c.tooOld && !values.to) {
    console.error("This version is too old to update by itself. Run the install line again to get the newest one.");
    return 1;
  }

  if (scanLockHeld(defaultDataDir(home))) {
    console.error("A scan is running. Update when it's done (it can also be stopped, and resumed later).");
    return 1;
  }
  const state = readServerState(home);
  let serverPid: number | undefined;
  if (state && (await healthy(`http://127.0.0.1:${state.port}`))) {
    try {
      const h = (await (await fetch(`http://127.0.0.1:${state.port}/api/health`, { signal: AbortSignal.timeout(1500) })).json()) as { scanning?: boolean };
      if (h.scanning) {
        console.error("A scan is running. Update when it's done (it can also be stopped, and resumed later).");
        return 1;
      }
    } catch {
      // went away: nothing to wait for
    }
    serverPid = state.pid;
  }

  console.log(`Updating RawJobs ${APP_VERSION} to ${m.version}...`);
  const started = Date.now();
  await startUpdate({ home, base, manifest: m, serverPid });
  if (serverPid) {
    try {
      process.kill(serverPid);
    } catch {
      // already stopped
    }
  }
  // The old version's helper now starts the new one and gives it a minute; wait for its verdict.
  for (let i = 0; i < 400; i++) {
    await sleep(500);
    const r = readLastUpdate(home);
    if (r && r.to === m.version && Date.parse(r.at) >= started) {
      if (r.ok) console.log(`RawJobs ${m.version} is running.`);
      else console.error(r.error);
      return r.ok ? 0 : 1;
    }
  }
  console.error(`The update is taking longer than expected. See ${join(home, "logs/update.log")}.`);
  return 1;
}

/**
 * `rawjobs shortcuts`: make (or repair) the RawJobs shortcut in the Start menu / Applications / app
 * menu, with its icon. They open the dashboard on whatever port it's on.
 *   --desktop    also put one on the Desktop
 */
export function shortcutsCommand(args: string[]): number {
  const { values } = parseArgs({ args, options: { desktop: { type: "boolean", default: false } } });
  const launcher = process.env.RAWJOBS_LAUNCHER;
  if (!BUNDLED || !launcher) {
    console.error("Shortcuts are for an installed copy of RawJobs (from the install line).");
    return 2;
  }
  const r = makeShortcuts(rawjobsHome(), launcher, { desktop: values.desktop, version: APP_VERSION });
  if (!r.ok) {
    console.error(`Couldn't make the RawJobs shortcuts: ${r.error}`);
    return 1;
  }
  for (const p of [r.menu, r.desktop]) if (p) console.log(`Shortcut: ${p}`);
  return 0;
}
