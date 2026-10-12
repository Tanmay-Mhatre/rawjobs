import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { iconIcns, iconIco, iconPng } from "./icon";

/**
 * The RawJobs shortcuts of an installed copy: one in the Start menu / ~/Applications / the app menu,
 * and one on the Desktop. Both run `rawjobs open`, which finds the port the dashboard is really on
 * (state.json) and starts RawJobs when it isn't running, so they always open the right page.
 *
 * The installers make them (`rawjobs shortcuts --desktop`), and so does the first start of a version
 * that knows about them (ensureShortcuts), so copies installed before them get them too. A Desktop
 * shortcut you delete stays deleted: only Settings → About (or `rawjobs shortcuts --desktop`) adds it again.
 *
 * The dashboard tells you about them once (a popup the first time you land on the Radar), and only
 * about the ones that really exist (shortcutState).
 */

/** RAWJOBS_HOME/shortcuts.json: what was made, where, and whether you've been told. */
type ShortcutFile = {
  version?: string;
  menu?: string | null;
  desktop?: string | null;
  desktopOffered?: boolean;
  /** Why the last try at a Desktop shortcut didn't make one (null: it did, or it wasn't asked for). */
  desktopError?: string | null;
  /** You've seen the dashboard's "RawJobs is on your Desktop" popup (closed it, or followed its link). */
  noticeSeen?: boolean;
};
const filePath = (home: string) => join(home, "shortcuts.json");

function readFile(home: string): ShortcutFile {
  try {
    return JSON.parse(readFileSync(filePath(home), "utf8")) as ShortcutFile;
  } catch {
    return {};
  }
}
const writeFile = (home: string, f: ShortcutFile) => writeFileSync(filePath(home), `${JSON.stringify(f, null, 1)}\n`);

export type ShortcutResult = { ok: boolean; menu: string | null; desktop: string | null; error?: string };

/** The icon file for this computer's shortcuts, written into RAWJOBS_HOME/icons. */
function writeIcon(home: string): string {
  const dir = join(home, "icons");
  mkdirSync(dir, { recursive: true });
  const [name, data] = process.platform === "win32" ? ["rawjobs.ico", iconIco()] : process.platform === "darwin" ? ["rawjobs.icns", iconIcns()] : ["rawjobs.png", iconPng(256)];
  const file = join(dir, name);
  writeFileSync(file, data);
  return file;
}

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 30_000, env: env ? { ...process.env, ...env } : process.env });

function windows(home: string, launcher: string, icon: string, desktop: boolean): ShortcutResult {
  // Paths go in through the environment, so no quoting can break the script.
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "$ws = New-Object -ComObject WScript.Shell",
    "function Make($path) { $l = $ws.CreateShortcut($path); $l.TargetPath = Join-Path $env:SystemRoot 'System32\\conhost.exe'; $l.Arguments = '--headless \"' + $env:RJ_LAUNCHER + '\" open'; $l.WorkingDirectory = $env:RJ_HOME; $l.Description = 'Open the RawJobs dashboard'; $l.IconLocation = $env:RJ_ICON + ',0'; $l.Save(); $path }",
    "'menu=' + (Make (Join-Path ([Environment]::GetFolderPath('Programs')) 'RawJobs.lnk'))",
    "if ($env:RJ_DESKTOP -eq '1') { 'desktop=' + (Make (Join-Path ([Environment]::GetFolderPath('Desktop')) 'RawJobs.lnk')) }",
  ].join("\n");
  const r = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    RJ_LAUNCHER: launcher,
    RJ_HOME: home,
    RJ_ICON: icon,
    RJ_DESKTOP: desktop ? "1" : "0",
  });
  const out = (key: string) => r.stdout?.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? null;
  return { ok: r.status === 0, menu: out("menu"), desktop: out("desktop"), error: r.status === 0 ? undefined : (r.stderr || String(r.error ?? "")).trim() };
}

function mac(launcher: string, icon: string, desktop: boolean): ShortcutResult {
  const apps = join(homedir(), "Applications");
  const app = join(apps, "RawJobs.app");
  mkdirSync(apps, { recursive: true });
  rmSync(app, { recursive: true, force: true });
  const quoted = launcher.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const r = run("osacompile", ["-o", app, "-e", `do shell script quoted form of "${quoted}" & " open >/dev/null 2>&1 &"`]);
  if (r.status !== 0) return { ok: false, menu: null, desktop: null, error: (r.stderr || String(r.error ?? "")).trim() };
  try {
    writeFileSync(join(app, "Contents/Resources/applet.icns"), readFileSync(icon));
    run("touch", [app]); // Finder reads the new icon
  } catch {
    // the default applet icon is fine too
  }
  let onDesktop: string | null = null;
  if (desktop) {
    const link = join(homedir(), "Desktop", "RawJobs.app");
    try {
      if (existsSync(join(homedir(), "Desktop"))) {
        rmSync(link, { recursive: true, force: true });
        symlinkSync(app, link);
        onDesktop = link;
      }
    } catch {
      // no Desktop we may write to
    }
  }
  return { ok: true, menu: app, desktop: onDesktop };
}

/** Where Linux keeps app-menu entries (install.sh uses the same). */
export const linuxAppsDir = () => join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "applications");

function linuxDesktopDir(): string | null {
  const r = run("xdg-user-dir", ["DESKTOP"]);
  const dir = r.status === 0 ? r.stdout.trim() : join(homedir(), "Desktop");
  return dir && dir !== homedir() && existsSync(dir) ? dir : null;
}

function linux(launcher: string, icon: string, desktop: boolean): ShortcutResult {
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=RawJobs",
    "Comment=Open the RawJobs dashboard",
    `Exec="${launcher}" open`,
    `Icon=${icon}`,
    "Terminal=false",
    "Categories=Office;",
    "",
  ].join("\n");
  const apps = linuxAppsDir();
  mkdirSync(apps, { recursive: true });
  const menu = join(apps, "rawjobs.desktop");
  writeFileSync(menu, entry);
  let onDesktop: string | null = null;
  const dir = desktop ? linuxDesktopDir() : null;
  if (dir) {
    onDesktop = join(dir, "rawjobs.desktop");
    writeFileSync(onDesktop, entry, { mode: 0o755 });
    // GNOME asks before running a Desktop file it doesn't trust.
    run("gio", ["set", onDesktop, "metadata::trusted", "true"]);
  }
  return { ok: true, menu, desktop: onDesktop };
}

/**
 * Make (or refresh) the shortcuts: the menu one always, the Desktop one when `desktop` is true.
 * `launcher` is the installed copy's bin/rawjobs(.cmd).
 */
export function makeShortcuts(home: string, launcher: string, opts: { desktop: boolean; version?: string }): ShortcutResult {
  let r: ShortcutResult;
  try {
    const icon = writeIcon(home);
    r = process.platform === "win32" ? windows(home, launcher, icon, opts.desktop) : process.platform === "darwin" ? mac(launcher, icon, opts.desktop) : linux(launcher, icon, opts.desktop);
  } catch (err) {
    r = { ok: false, menu: null, desktop: null, error: (err as Error).message };
  }
  if (r.ok && opts.desktop && !r.desktop) r = { ...r, error: r.error ?? "there's no Desktop folder to put it in" };
  const before = readFile(home);
  writeFile(home, {
    ...before,
    version: opts.version ?? before.version,
    menu: r.menu ?? before.menu ?? null,
    // Keep track of a Desktop shortcut made before when this run didn't make one.
    desktop: r.desktop ?? before.desktop ?? null,
    desktopOffered: before.desktopOffered || opts.desktop,
    desktopError: opts.desktop ? (r.desktop ? null : (r.error ?? "it couldn't be made")) : (before.desktopError ?? null),
  });
  return r;
}

const exists = (p: string | null | undefined) => {
  if (!p) return false;
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

let desktopFolder: boolean | undefined;
/** Whether this computer has a Desktop folder at all (a Linux without one keeps RawJobs in the app menu). */
function hasDesktopFolder(): boolean {
  desktopFolder ??= process.platform === "win32" ? true : process.platform === "darwin" ? existsSync(join(homedir(), "Desktop")) : linuxDesktopDir() !== null;
  return desktopFolder;
}

/** What the dashboard shows: which shortcuts really exist now, and whether to tell you about them. */
export type ShortcutState = {
  desktop: boolean;
  menu: boolean;
  /** False on a Linux with no Desktop folder: the Desktop row is left out. */
  desktopFolder: boolean;
  /** Why the Desktop shortcut couldn't be made, while it's missing. */
  desktopError: string | null;
  /** Show the one-time popup: a shortcut exists and you haven't been told yet. */
  notice: boolean;
};

export function shortcutState(home: string): ShortcutState {
  const f = readFile(home);
  const desktop = exists(f.desktop);
  const menu = exists(f.menu);
  return { desktop, menu, desktopFolder: hasDesktopFolder(), desktopError: desktop ? null : (f.desktopError ?? null), notice: !f.noticeSeen && (desktop || menu) };
}

/** You've seen the popup (or added a shortcut yourself): it never shows again on this computer. */
export function markShortcutNoticeSeen(home: string): void {
  writeFile(home, { ...readFile(home), noticeSeen: true });
}

/**
 * On the first start of each version: refresh the menu shortcut (its icon, its launcher), and add
 * the Desktop one once, for copies installed before there was one. Never throws.
 */
export function ensureShortcuts(home: string, launcher: string | undefined, version: string): void {
  if (!launcher) return;
  const f = readFile(home);
  if (f.version === version) return;
  const r = makeShortcuts(home, launcher, { desktop: !f.desktopOffered, version });
  if (!r.ok) console.log(`Couldn't refresh the RawJobs shortcuts: ${r.error}`);
}

/** Remove every shortcut RawJobs made (uninstall). */
export function removeShortcuts(home: string): void {
  const f = readFile(home);
  const rm = (p: string | null | undefined) => p && rmSync(p, { recursive: true, force: true });
  if (process.platform === "win32") {
    const ps = ["foreach ($f in 'Programs', 'Startup', 'Desktop') { Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath($f)) 'RawJobs.lnk') }"].join("; ");
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  } else if (process.platform === "darwin") {
    rm(join(homedir(), "Applications/RawJobs.app"));
    // The Desktop one is a link: remove the link, never what it points to.
    try {
      if (lstatSync(join(homedir(), "Desktop/RawJobs.app")).isSymbolicLink()) rmSync(join(homedir(), "Desktop/RawJobs.app"), { force: true });
    } catch {
      // not there
    }
  } else {
    rm(join(linuxAppsDir(), "rawjobs.desktop"));
    rm(join(homedir(), ".local/share/applications/rawjobs.desktop"));
    const d = linuxDesktopDir();
    if (d) rm(join(d, "rawjobs.desktop"));
  }
  if (f.desktop && process.platform !== "darwin") rm(f.desktop);
  if (f.menu && process.platform !== "darwin") rm(f.menu);
  rm(filePath(home));
}
