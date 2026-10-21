import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alreadyRunning, AUTOSTART, ensureAutostart, portTaken, readServerState, serverHolding, serverRunning, writeServerState } from "../src/desktop";
import { iconIcns, iconIco, iconPng, markPixels } from "../src/icon";
import { portOrder } from "../src/serve";
import { markShortcutNoticeSeen, shortcutState } from "../src/shortcuts";

const root = join(import.meta.dirname, "../../..");

describe("an installed copy's server", () => {
  it("goes back to 4317 when it's free, after a start that had to use 4318", () => {
    expect(portOrder(4317, 4318)).toEqual([4317, 4318, 4319, 4320, 4321, 4322, 4323, 4324, 4325, 4326]);
    expect(portOrder(4317, null)).toEqual([4317, 4318, 4319, 4320, 4321, 4322, 4323, 4324, 4325, 4326]);
    expect(portOrder(4317, 4321)).toEqual([4317, 4321, 4318, 4319, 4320, 4322, 4323, 4324, 4325, 4326]);
    expect(portOrder(4317, 4317)).toEqual([4317, 4318, 4319, 4320, 4321, 4322, 4323, 4324, 4325, 4326]);
  });

  it("records where it runs, for the shortcut", () => {
    const home = mkdtempSync(join(tmpdir(), "rj-state-"));
    expect(readServerState(home)).toBeNull();
    writeServerState(4318, home);
    expect(readServerState(home)).toMatchObject({ port: 4318, pid: process.pid });
  });

  it("waits for a busy server that's slow to answer, instead of starting a second one", async () => {
    // Its first answer takes 2 s (longer than the quick check waits); its process is there all along.
    const slow = spawn(
      process.execPath,
      ["-e", `let n=0;require("http").createServer((q,s)=>setTimeout(()=>s.end('{"ok":true}'),n++?0:2000)).listen(0,"127.0.0.1",function(){console.log(this.address().port)})`],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      const port = await new Promise<number>((done) => slow.stdout!.once("data", (d) => done(Number(String(d).trim()))));
      const state = { port, pid: slow.pid!, version: "0.1.0", startedAt: "" };
      expect(await serverRunning(state, { pauseMs: 10 })).toBe(true);
    } finally {
      slow.kill();
    }
    // Nothing there, and its process is gone: start a new one.
    expect(await serverRunning({ port: 1, pid: 999_999_99, version: "0.1.0", startedAt: "" }, { pauseMs: 10 })).toBe(false);
    expect(await serverRunning(null)).toBe(false);
  }, 20_000);

  it("doesn't start a second server next to one that holds its port but doesn't answer", async () => {
    const home = mkdtempSync(join(tmpdir(), "rj-hung-"));
    // Accepts connections and never answers the first `n` requests (a hung or very busy server).
    const hung = (n: number) =>
      spawn(process.execPath, ["-e", `let n=0;require("http").createServer((q,s)=>{if(n++>=${n})s.end('{"ok":true}')}).listen(0,"127.0.0.1",function(){console.log(this.address().port)})`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    const fast = { tries: 1, waitTries: 2, timeoutMs: 300, pauseMs: 10 };
    // Its command line, as the computer reports it: this folder's installed version.
    const commandLine = () => `"${join(home, "runtime/node.exe")}" "${join(home, "app/versions/0.1.0/cli.mjs")}" serve`;
    const holding = (s: Parameters<typeof serverHolding>[0], h: string) => serverHolding(s, h, { commandLine });
    for (const [n, want] of [
      [99, "stuck"],
      [2, "running"],
    ] as const) {
      const child = hung(n);
      try {
        const port = await new Promise<number>((done) => child.stdout!.once("data", (d) => done(Number(String(d).trim()))));
        const state = { port, pid: child.pid!, version: "0.1.0", startedAt: "" };
        expect(await portTaken(port)).toBe(true);
        expect(await alreadyRunning(state, home, { ...fast, holding })).toBe(want);
        // A process of another program holding the port isn't this folder's server: start as before.
        expect(await serverHolding(state, home, { commandLine: () => "C:\\Other\\app.exe" })).toBe(false);
      } finally {
        child.kill();
      }
    }
    // Its process is gone: nothing holds the port, start a new one.
    expect(await alreadyRunning({ port: 1, pid: 999_999_99, version: "0.1.0", startedAt: "" }, home, { ...fast, holding })).toBeNull();
  }, 20_000);

  it("is registered by the installers under the names uninstall removes", () => {
    const ps1 = readFileSync(join(root, "packaging/install.ps1"), "utf8");
    const sh = readFileSync(join(root, "packaging/install.sh"), "utf8");
    expect(ps1).toContain(`$TaskName = '${AUTOSTART.windowsTask}'`);
    expect(sh).toContain(`LABEL='${AUTOSTART.macLabel}'`);
    expect(sh).toContain(`UNIT='${AUTOSTART.linuxUnit}'`);
  });
});

describe("the scheduled tasks of a copy installed before", () => {
  it("are brought up to date once per version: the server at normal priority, nothing waking the laptop", async () => {
    const home = mkdtempSync(join(tmpdir(), "rj-autostart-"));
    const scripts: string[] = [];
    const run = async (script: string) => {
      scripts.push(script);
      return 0;
    };
    await ensureAutostart(home, "0.7.0", { platform: "win32", run });
    await ensureAutostart(home, "0.7.0", { platform: "win32", run });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(`Get-ScheduledTask -TaskName '${AUTOSTART.windowsTask}'`);
    expect(scripts[0]).toContain("$t.Settings.Priority = 5");
    expect(scripts[0]).toContain("Get-ScheduledTask -TaskName 'RawJobs Scan'");
    expect(scripts[0]).toContain("Get-ScheduledTask -TaskName 'RawJobs daily summary'");
    expect(scripts[0]).toContain("$t.Settings.WakeToRun = $false");
    await ensureAutostart(home, "0.7.1", { platform: "win32", run });
    expect(scripts).toHaveLength(2);
    // Only Windows has these tasks.
    await ensureAutostart(mkdtempSync(join(tmpdir(), "rj-autostart-")), "0.7.0", { platform: "darwin", run });
    expect(scripts).toHaveLength(2);
  });

  it("never throws when PowerShell fails, and tries again next start", async () => {
    const home = mkdtempSync(join(tmpdir(), "rj-autostart-"));
    let tries = 0;
    const run = (code: number) => async () => {
      tries++;
      return code;
    };
    await ensureAutostart(home, "0.7.0", { platform: "win32", run: run(1) });
    await ensureAutostart(home, "0.7.0", { platform: "win32", run: () => Promise.reject(new Error("no powershell")) });
    expect(tries).toBe(1);
    await ensureAutostart(home, "0.7.0", { platform: "win32", run: run(0) });
    expect(tries).toBe(2);
  });
});

describe("the shortcut icon", () => {
  it("draws the mark: the orange bar on the dark square", () => {
    const px = markPixels(64);
    const at = (x: number, y: number) => [...px.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect(at(2, 2)).toEqual([0x15, 0x14, 0x12, 255]);
    expect(at(32, 32)).toEqual([0xff, 0x5a, 0x1f, 255]);
  });

  it("is a PNG, an ICO and an ICNS of the right sizes", () => {
    const png = iconPng(48);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(48);
    const ico = iconIco([16, 256]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0); // 256 is written as 0
    const icns = iconIcns();
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});

describe("what the dashboard says about the shortcuts", () => {
  it("only tells you about shortcuts that really exist, once", () => {
    const home = mkdtempSync(join(tmpdir(), "rj-sc-"));
    // Nothing made yet: nothing to tell.
    expect(shortcutState(home)).toMatchObject({ desktop: false, menu: false, notice: false });
    const lnk = join(home, "RawJobs.lnk");
    writeFileSync(lnk, "");
    writeFileSync(join(home, "shortcuts.json"), JSON.stringify({ desktop: lnk, menu: lnk }));
    expect(shortcutState(home)).toMatchObject({ desktop: true, menu: true, notice: true, desktopError: null });
    markShortcutNoticeSeen(home);
    expect(shortcutState(home).notice).toBe(false);
    // Deleted from the Desktop: says so, and never brings the popup back.
    rmSync(lnk);
    expect(shortcutState(home)).toMatchObject({ desktop: false, notice: false });
  });

  it("says why a Desktop shortcut couldn't be made, until there is one", () => {
    const home = mkdtempSync(join(tmpdir(), "rj-sc-"));
    const menu = join(home, "menu.lnk");
    writeFileSync(menu, "");
    writeFileSync(join(home, "shortcuts.json"), JSON.stringify({ menu, desktop: null, desktopError: "access denied" }));
    expect(shortcutState(home)).toMatchObject({ desktop: false, menu: true, desktopError: "access denied", notice: true });
  });
});
