import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every command the shortcuts code runs (PowerShell, osacompile, xdg-*) goes through this stub, and
// the home folder is a temp one: nothing on this computer is touched.
type Call = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv };
const calls: Call[] = [];
let answer: (cmd: string, args: string[]) => { status: number; stdout?: string; stderr?: string } = () => ({ status: 0 });
let fakeHome = "";

vi.mock("node:child_process", () => ({
  spawnSync: (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: opts?.env });
    return { stdout: "", stderr: "", ...answer(cmd, args) };
  },
}));
vi.mock("node:os", async (orig) => ({ ...(await orig<typeof import("node:os")>()), homedir: () => fakeHome }));

const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

/** A fresh copy of the module: it remembers whether there's a Desktop folder. */
const load = async () => {
  vi.resetModules();
  return import("../src/shortcuts");
};

let home: string;
beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "rawjobs-shortcuts-"));
  home = join(fakeHome, "RawJobs");
  mkdirSync(home);
  calls.length = 0;
  answer = () => ({ status: 0 });
  vi.stubEnv("XDG_DATA_HOME", "");
});
afterEach(() => {
  onPlatform(realPlatform);
  vi.unstubAllEnvs();
  rmSync(fakeHome, { recursive: true, force: true });
});

const saved = () => JSON.parse(readFileSync(join(home, "shortcuts.json"), "utf8"));

describe("shortcuts on Linux", () => {
  beforeEach(() => {
    onPlatform("linux");
    mkdirSync(join(fakeHome, "Desktop"));
    answer = (cmd) => (cmd === "xdg-user-dir" ? { status: 0, stdout: `${join(fakeHome, "Desktop")}\n` } : { status: 0 });
  });

  it("writes rawjobs.desktop to the app menu and the Desktop, with the launcher and the icon", async () => {
    const { makeShortcuts } = await load();
    const r = makeShortcuts(home, "/opt/rawjobs/bin/rawjobs", { desktop: true, version: "1.2.3" });
    const menu = join(fakeHome, ".local/share/applications/rawjobs.desktop");
    expect(r).toMatchObject({ ok: true, menu, desktop: join(fakeHome, "Desktop/rawjobs.desktop"), startLink: true });
    const entry = readFileSync(menu, "utf8");
    expect(entry).toContain('Exec="/opt/rawjobs/bin/rawjobs" open');
    expect(entry).toContain(`Icon=${join(home, "icons/rawjobs.png")}`);
    expect(existsSync(join(home, "icons/rawjobs.png"))).toBe(true);
    expect(readFileSync(join(fakeHome, "Desktop/rawjobs.desktop"), "utf8")).toBe(entry);
    // GNOME trusts the Desktop file, and rawjobs: links start RawJobs.
    expect(calls.some((c) => c.cmd === "gio" && c.args.includes("metadata::trusted"))).toBe(true);
    expect(readFileSync(join(fakeHome, ".local/share/applications/rawjobs-open.desktop"), "utf8")).toContain("MimeType=x-scheme-handler/rawjobs;");
    expect(saved()).toMatchObject({ version: "1.2.3", menu, desktopOffered: true, desktopError: null, startLink: true });
  });

  it("says why there's no Desktop shortcut on a computer without a Desktop folder", async () => {
    rmSync(join(fakeHome, "Desktop"), { recursive: true });
    answer = () => ({ status: 1 });
    const { makeShortcuts, shortcutState } = await load();
    const r = makeShortcuts(home, "/opt/rawjobs/bin/rawjobs", { desktop: true });
    expect(r).toMatchObject({ ok: true, desktop: null, error: "there's no Desktop folder to put it in", startLink: false });
    expect(saved().desktopError).toBe("there's no Desktop folder to put it in");
    expect(shortcutState(home)).toMatchObject({ desktop: false, menu: true, desktopFolder: false });
  });

  it("removeShortcuts removes the menu entry, the link handler, the Desktop file and its record", async () => {
    const { makeShortcuts, removeShortcuts } = await load();
    makeShortcuts(home, "/opt/rawjobs/bin/rawjobs", { desktop: true });
    removeShortcuts(home);
    for (const f of [".local/share/applications/rawjobs.desktop", ".local/share/applications/rawjobs-open.desktop", "Desktop/rawjobs.desktop"]) expect(existsSync(join(fakeHome, f)), f).toBe(false);
    expect(existsSync(join(home, "shortcuts.json"))).toBe(false);
    // Already gone: nothing to do, no error.
    expect(() => removeShortcuts(home)).not.toThrow();
  });
});

describe("shortcuts on Windows", () => {
  beforeEach(() => onPlatform("win32"));

  it("makes the Start menu and Desktop links through PowerShell, with paths in the environment", async () => {
    answer = (_cmd, args) => (args.at(-1)?.includes("WScript.Shell") ? { status: 0, stdout: "menu=C:\\Menu\\RawJobs.lnk\r\ndesktop=C:\\Desktop\\RawJobs.lnk\r\n" } : { status: 0 });
    const { makeShortcuts } = await load();
    const launcher = "C:\\Users\\O'Neil\\RawJobs\\bin\\rawjobs.cmd";
    const r = makeShortcuts(home, launcher, { desktop: true });
    expect(r).toMatchObject({ ok: true, menu: "C:\\Menu\\RawJobs.lnk", desktop: "C:\\Desktop\\RawJobs.lnk", startLink: true });
    const [links, startLink] = calls.filter((c) => c.cmd === "powershell.exe");
    // The path with a quote never goes into the script itself.
    expect(links!.args.at(-1)).not.toContain("O'Neil");
    expect(links!.env).toMatchObject({ RJ_LAUNCHER: launcher, RJ_HOME: home, RJ_ICON: join(home, "icons/rawjobs.ico"), RJ_DESKTOP: "1" });
    expect(startLink!.args.at(-1)).toContain("HKCU:\\Software\\Classes\\rawjobs");
  });

  it("records PowerShell's error when the links can't be made", async () => {
    answer = () => ({ status: 1, stderr: "Access is denied." });
    const { makeShortcuts } = await load();
    const r = makeShortcuts(home, "C:\\rawjobs.cmd", { desktop: true });
    expect(r).toMatchObject({ ok: false, menu: null, desktop: null, error: "Access is denied.", startLink: false });
    expect(saved()).toMatchObject({ desktop: null, desktopError: "Access is denied.", startLink: false });
  });
});

describe("shortcuts on macOS", () => {
  beforeEach(() => onPlatform("darwin"));

  it("compiles ~/Applications/RawJobs.app, adds the rawjobs: link and signs it again", async () => {
    answer = (cmd, args) => {
      // osacompile -o <app>: leave an app bundle behind, as the real one does.
      if (cmd === "osacompile") mkdirSync(join(args[1]!, "Contents/Resources"), { recursive: true });
      return { status: 0 };
    };
    const { makeShortcuts } = await load();
    const r = makeShortcuts(home, '/Users/me/RawJobs/bin/raw"jobs', { desktop: false });
    const app = join(fakeHome, "Applications/RawJobs.app");
    expect(r).toMatchObject({ ok: true, menu: app, desktop: null, startLink: true });
    expect(existsSync(join(app, "Contents/Resources/applet.icns"))).toBe(true);
    const script = calls.find((c) => c.cmd === "osacompile")!.args.join("\n");
    expect(script).toContain('raw\\"jobs');
    expect(script).toContain("on open location this_url");
    expect(calls.map((c) => c.cmd)).toEqual(expect.arrayContaining(["plutil", "codesign", "touch"]));
    // The work folder it made the app in is gone.
    expect(existsSync(join(fakeHome, `Applications/.rawjobs-${process.pid}`))).toBe(false);
  });

  it("reports osacompile's error and leaves no half-made app", async () => {
    answer = (cmd) => (cmd === "osacompile" ? { status: 1, stderr: "syntax error" } : { status: 0 });
    const { makeShortcuts } = await load();
    expect(makeShortcuts(home, "/x/rawjobs", { desktop: false })).toMatchObject({ ok: false, error: "syntax error" });
    expect(existsSync(join(fakeHome, "Applications/RawJobs.app"))).toBe(false);
  });
});

describe("ensureShortcuts and the dashboard's notice", () => {
  beforeEach(() => {
    onPlatform("linux");
    mkdirSync(join(fakeHome, "Desktop"));
    answer = (cmd) => (cmd === "xdg-user-dir" ? { status: 0, stdout: join(fakeHome, "Desktop") } : { status: 0 });
  });

  it("refreshes once per version, and offers the Desktop shortcut only the first time", async () => {
    const { ensureShortcuts } = await load();
    ensureShortcuts(home, undefined, "1.0.0");
    expect(existsSync(join(home, "shortcuts.json"))).toBe(false);

    ensureShortcuts(home, "/opt/rawjobs/bin/rawjobs", "1.0.0");
    expect(saved()).toMatchObject({ version: "1.0.0", desktopOffered: true });
    expect(existsSync(join(fakeHome, "Desktop/rawjobs.desktop"))).toBe(true);

    // Same version: nothing runs.
    const before = calls.length;
    ensureShortcuts(home, "/opt/rawjobs/bin/rawjobs", "1.0.0");
    expect(calls.length).toBe(before);

    // You deleted the Desktop one: the next version refreshes the menu, and leaves the Desktop alone.
    rmSync(join(fakeHome, "Desktop/rawjobs.desktop"));
    ensureShortcuts(home, "/opt/rawjobs/bin/rawjobs", "1.1.0");
    expect(saved().version).toBe("1.1.0");
    expect(existsSync(join(fakeHome, "Desktop/rawjobs.desktop"))).toBe(false);
  });

  it("tells you once about shortcuts that really exist", async () => {
    const { makeShortcuts, markShortcutNoticeSeen, shortcutState, startLinkInstalled } = await load();
    expect(shortcutState(home)).toMatchObject({ desktop: false, menu: false, notice: false });
    makeShortcuts(home, "/opt/rawjobs/bin/rawjobs", { desktop: true });
    expect(shortcutState(home)).toEqual({ desktop: true, menu: true, desktopFolder: true, desktopError: null, notice: true });
    expect(startLinkInstalled(home)).toBe(true);
    markShortcutNoticeSeen(home);
    expect(shortcutState(home).notice).toBe(false);
    // A shortcut deleted by hand isn't claimed.
    rmSync(join(fakeHome, "Desktop/rawjobs.desktop"));
    expect(shortcutState(home).desktop).toBe(false);
  });
});
