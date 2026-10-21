import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNetworkStore } from "../src/network/store";
import { createWatcher, DOWNLOADS_GUID, downloadsFolder, expandWindowsVars, isLinkedInExport, nodeWatchDeps, parseRegQuery, type WatchDeps } from "../src/network/watch";
import { makeZip } from "./fixtures/linkedin/make-zip";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/linkedin/${name}`, import.meta.url), "utf8");
const EXPORT = makeZip([
  { name: "Connections.csv", data: fixture("Connections.csv") },
  { name: "Positions.csv", data: fixture("Positions.csv") },
  { name: "messages.csv", data: "secret" },
]);
const T0 = Date.parse("2026-10-20T10:00:00.000Z");

const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
const errno = (code: string) => Object.assign(new Error(code), { code });

/** A fake computer for downloadsFolder: only what each test gives it exists. */
function fakeDeps(o: { platform: NodeJS.Platform; env?: Record<string, string>; dirs?: string[]; files?: Record<string, string>; reg?: string | Error }): WatchDeps {
  const dirs = new Set(o.dirs ?? []);
  const isDirStats = (p: string) => ({ size: 0, mtimeMs: 0, isFile: () => false, isDirectory: () => dirs.has(p) });
  return {
    ...nodeWatchDeps(),
    platform: o.platform,
    env: o.env ?? {},
    homedir: () => (o.platform === "win32" ? "C:\\Users\\sam" : "/home/sam"),
    exec: async () => {
      if (o.reg instanceof Error || o.reg === undefined) throw o.reg ?? new Error("no reg");
      return o.reg;
    },
    stat: async (p) => {
      if (!dirs.has(p)) throw enoent();
      return isDirStats(p);
    },
    readText: async (p) => {
      const t = o.files?.[p];
      if (t === undefined) throw enoent();
      return t;
    },
  };
}

const regOut = (value: string, type = "REG_EXPAND_SZ") =>
  `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    ${DOWNLOADS_GUID}    ${type}    ${value}\r\n\r\n`;

describe("finding the Downloads folder", () => {
  it("reads Windows' registry value and expands every %VAR%", async () => {
    const deps = fakeDeps({ platform: "win32", env: { userprofile: "C:\\Users\\sam", ONEDRIVE: "D:\\OneDrive" }, reg: regOut("%OneDrive%\\%USERPROFILE%x"), dirs: ["D:\\OneDrive\\C:\\Users\\samx"] });
    expect(await downloadsFolder(deps)).toBe("D:\\OneDrive\\C:\\Users\\samx");
    expect(await downloadsFolder(fakeDeps({ platform: "win32", reg: regOut("E:\\Downloads", "REG_SZ"), dirs: ["E:\\Downloads"] }))).toBe("E:\\Downloads");
  });

  it("falls back to home/Downloads when reg fails, a %VAR% isn't set, or the folder isn't there", async () => {
    const home = "C:\\Users\\sam\\Downloads";
    expect(await downloadsFolder(fakeDeps({ platform: "win32", reg: new Error("timeout") }))).toBe(home);
    expect(await downloadsFolder(fakeDeps({ platform: "win32", reg: regOut("%NOPE%\\Downloads"), dirs: ["\\Downloads"] }))).toBe(home);
    expect(await downloadsFolder(fakeDeps({ platform: "win32", reg: regOut("E:\\Gone") }))).toBe(home);
  });

  it("asks reg once, without a shell, with the Downloads GUID", async () => {
    const calls: string[][] = [];
    const deps = {
      ...fakeDeps({ platform: "win32" }),
      exec: async (file: string, args: string[]) => {
        calls.push([file, ...args]);
        return "";
      },
    };
    await downloadsFolder(deps);
    expect(calls).toEqual([["reg", "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", DOWNLOADS_GUID]]);
  });

  it("reads XDG_DOWNLOAD_DIR on Linux, else ~/Downloads", async () => {
    const files = { "/home/sam/.config/user-dirs.dirs": '# made by xdg-user-dirs\nXDG_DESKTOP_DIR="$HOME/Desktop"\nXDG_DOWNLOAD_DIR="$HOME/Téléchargements"\n' };
    expect(await downloadsFolder(fakeDeps({ platform: "linux", files, dirs: ["/home/sam/Téléchargements"] }))).toBe("/home/sam/Téléchargements");
    expect(await downloadsFolder(fakeDeps({ platform: "linux", files }))).toBe("/home/sam/Downloads");
    expect(await downloadsFolder(fakeDeps({ platform: "linux" }))).toBe("/home/sam/Downloads");
  });

  it("isn't offered on macOS, and RAWJOBS_DOWNLOADS points it anywhere", async () => {
    expect(await downloadsFolder(fakeDeps({ platform: "darwin" }))).toBeNull();
    expect(await downloadsFolder(fakeDeps({ platform: "darwin", env: { RAWJOBS_DOWNLOADS: "/tmp/scratch" } }))).toMatch(/scratch$/);
  });

  it("parses reg's answer and %VAR% expansion on their own", () => {
    expect(parseRegQuery(regOut("%USERPROFILE%\\Downloads"))).toBe("%USERPROFILE%\\Downloads");
    expect(parseRegQuery("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
    expect(expandWindowsVars("%A%-%b%", { a: "1", B: "2" })).toBe("1-2");
    expect(expandWindowsVars("%A%", {})).toBeNull();
  });
});

describe("LinkedIn's file name", () => {
  it("matches the export in any case, Complete_ and a browser's (1)", () => {
    for (const n of [
      "Basic_LinkedInDataExport_10-20-2026.zip",
      "Complete_LinkedInDataExport_10-20-2026.zip",
      "basic_linkedindataexport_10-20-2026.ZIP",
      "Basic_LinkedInDataExport_10-20-2026 (1).zip",
      "LinkedInDataExport.zip",
    ])
      expect(isLinkedInExport(n)).toBe(true);
    for (const n of ["Basic_LinkedInDataExport_10-20-2026.zip.crdownload", "Basic_LinkedInDataExport_10-20-2026.zip.part", "photos.zip", "Connections.csv", "my LinkedInDataExport.zip"])
      expect(isLinkedInExport(n)).toBe(false);
  });
});

/** A watcher over a temp home and a temp "Downloads", with a hand-turned clock and timer. */
function setup(o: { pid?: number; alive?: (pid: number) => boolean; open?: WatchDeps["open"]; readdir?: WatchDeps["readdir"]; home?: string; downloads?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rawjobs-watch-"));
  const home = o.home ?? join(root, "home");
  const downloads = o.downloads ?? join(root, "Downloads");
  mkdirSync(home, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  const clock = { t: T0 };
  const logs: string[] = [];
  const timers: number[] = [];
  const store = createNetworkStore(home, () => new Date(clock.t));
  const base = nodeWatchDeps();
  const deps: WatchDeps = {
    ...base,
    platform: "win32",
    env: { RAWJOBS_DOWNLOADS: downloads },
    now: () => clock.t,
    schedule: (_fn, ms) => timers.push(ms),
    cancel: () => {},
    log: (l) => logs.push(l),
    pid: o.pid ?? 100,
    alive: o.alive ?? (() => false),
    open: o.open ?? base.open,
    readdir: o.readdir ?? base.readdir,
  };
  const watcher = createWatcher(home, store, deps);
  const put = (name: string, data: Uint8Array | string = EXPORT, mtime = clock.t) => {
    const p = join(downloads, name);
    writeFileSync(p, data);
    utimesSync(p, new Date(mtime), new Date(mtime));
    return p;
  };
  const statePath = join(home, "profile/network-watch.json");
  return { home, downloads, clock, logs, timers, store, watcher, put, statePath, deps };
}

describe("the Downloads watcher", () => {
  it("imports LinkedIn's export, stops, and logs only names and sizes", async () => {
    const s = setup();
    const r = await s.watcher.start();
    expect(r).toEqual({ ok: true, watch: { since: "2026-10-20T10:00:00.000Z", until: "2026-10-22T10:00:00.000Z", folder: "Downloads" } });
    expect(s.watcher.state()?.until).toBe("2026-10-22T10:00:00.000Z");
    s.put("holiday.zip");
    s.put("Basic_LinkedInDataExport_10-20-2026.zip");
    await s.watcher.poll();
    const st = s.store.status();
    expect(st.connected && st.source === "downloads" && st.fileName).toBe("Basic_LinkedInDataExport_10-20-2026.zip");
    expect(existsSync(s.statePath)).toBe(false);
    expect(s.watcher.state()).toBeNull();
    expect(s.logs).toEqual([
      "Watching Downloads for LinkedIn's export until 2026-10-22T10:00:00.000Z.",
      `Found Basic_LinkedInDataExport_10-20-2026.zip (${EXPORT.length} bytes) in Downloads and imported it.`,
      "Stopped watching Downloads (found).",
    ]);
    expect(s.logs.join("\n")).not.toContain(s.downloads);
  });

  it("caps a watch at 48 hours", async () => {
    const s = setup();
    const r = await s.watcher.start(500);
    expect(r.ok && r.watch.until).toBe("2026-10-22T10:00:00.000Z");
  });

  it("skips empty, partial, old and non-regular files without opening them", async () => {
    const opened: string[] = [];
    const base = nodeWatchDeps();
    const s = setup({
      open: (p) => {
        opened.push(p);
        return base.open(p);
      },
    });
    await s.watcher.start();
    s.put("Basic_LinkedInDataExport_1.zip", "");
    s.put("Basic_LinkedInDataExport_2.zip.crdownload");
    s.put("Basic_LinkedInDataExport_3.zip.part");
    s.put("Basic_LinkedInDataExport_4.zip", EXPORT, T0 - 3_600_000);
    mkdirSync(join(s.downloads, "Basic_LinkedInDataExport_5.zip"));
    await s.watcher.poll();
    expect(opened).toEqual([]);
    expect(s.store.status().connected).toBe(false);
    expect(s.watcher.state()).not.toBeNull();
  });

  it("tries a bad file once, keeps watching, and tries it again once it changes", async () => {
    const opened: string[] = [];
    const base = nodeWatchDeps();
    const s = setup({
      open: (p) => {
        opened.push(p);
        return base.open(p);
      },
    });
    await s.watcher.start();
    s.put("Basic_LinkedInDataExport_10-20-2026.zip", EXPORT.subarray(0, 40));
    await s.watcher.poll();
    await s.watcher.poll();
    expect(opened).toHaveLength(1);
    expect(s.watcher.state()?.lastError).toBe("ZIP_MALFORMED");
    expect(s.logs).toContain("Couldn't read Basic_LinkedInDataExport_10-20-2026.zip (40 bytes) from Downloads: ZIP_MALFORMED.");
    // The download finishes: a new size, so it's read again.
    s.put("Basic_LinkedInDataExport_10-20-2026.zip");
    await s.watcher.poll();
    expect(opened).toHaveLength(2);
    expect(s.store.status().connected).toBe(true);
  });

  it("retries a file that's busy or locked on the next poll, without an error", async () => {
    const base = nodeWatchDeps();
    let locked = 2;
    const s = setup({ open: async (p) => (locked-- > 0 ? Promise.reject(errno(locked ? "EBUSY" : "EPERM")) : base.open(p)) });
    await s.watcher.start();
    s.put("Basic_LinkedInDataExport_10-20-2026.zip");
    await s.watcher.poll();
    await s.watcher.poll();
    expect(s.store.status().connected).toBe(false);
    expect(s.watcher.state()?.lastError).toBeUndefined();
    await s.watcher.poll();
    expect(s.store.status().connected).toBe(true);
  });

  it("says NO_ACCESS when Downloads can't be listed, and saves no watch", async () => {
    const s = setup({ readdir: () => Promise.reject(errno("EPERM")) });
    expect(await s.watcher.start()).toEqual({ ok: false, code: "NO_ACCESS" });
    expect(existsSync(s.statePath)).toBe(false);
    const missing = setup({ downloads: join(tmpdir(), "rawjobs-watch-none", "x") });
    missing.deps.readdir = () => Promise.reject(enoent());
    expect(await createWatcher(missing.home, missing.store, missing.deps).start()).toEqual({ ok: false, code: "NO_FOLDER" });
  });

  it("never imports the same file twice, also across overlapping polls and a restart", async () => {
    const s = setup();
    await s.watcher.start();
    s.put("Basic_LinkedInDataExport_10-20-2026.zip");
    let imports = 0;
    const real = s.store.import;
    s.store.import = (...a) => {
      imports++;
      return real(...a);
    };
    await Promise.all([s.watcher.poll(), s.watcher.poll()]);
    await s.watcher.poll();
    expect(imports).toBe(1);
    // After a restart there's no watch left to carry on with.
    const again = setup({ home: s.home, downloads: s.downloads });
    again.watcher.resume();
    expect(again.timers).toEqual([]);
  });

  it("stops at until, and an expired or damaged state file is deleted", async () => {
    const s = setup();
    await s.watcher.start(1);
    s.clock.t += 2 * 3_600_000;
    s.put("Basic_LinkedInDataExport_10-20-2026.zip");
    await s.watcher.poll();
    expect(s.store.status().connected).toBe(false);
    expect(existsSync(s.statePath)).toBe(false);
    expect(s.logs.at(-1)).toBe("Stopped watching Downloads (expired).");

    writeFileSync(s.statePath, "{ not json");
    expect(s.watcher.state()).toBeNull();
    expect(existsSync(s.statePath)).toBe(false);
  });

  it("carries on after a restart, and a second server sees the watch but leaves it to the first", async () => {
    const a = setup({ pid: 1 });
    await a.watcher.start();
    a.watcher.close();
    expect(existsSync(a.statePath)).toBe(true);

    // Server B starts while A is still running: it shows the watch, but doesn't poll.
    const b = setup({ pid: 2, alive: () => true, home: a.home, downloads: a.downloads });
    expect(b.watcher.state()?.folder).toBe("Downloads");
    b.watcher.resume();
    expect(b.timers).toEqual([]);

    // A has gone: B picks the watch up and finds the file.
    const c = setup({ pid: 3, alive: () => false, home: a.home, downloads: a.downloads });
    c.watcher.resume();
    expect(c.timers).toEqual([0]);
    c.put("Basic_LinkedInDataExport_10-20-2026.zip");
    await c.watcher.poll();
    expect(c.store.status().connected).toBe(true);
  });

  it("a stop while a file is being read leaves no watch behind", async () => {
    const base = nodeWatchDeps();
    let stop = () => {};
    const s = setup({
      open: (p) => {
        stop();
        return base.open(p);
      },
    });
    stop = () => s.watcher.stop();
    await s.watcher.start();
    s.put("Basic_LinkedInDataExport_10-20-2026.zip", "not a zip");
    const before = s.timers.length;
    await s.watcher.poll();
    expect(existsSync(s.statePath)).toBe(false);
    expect(s.timers.length).toBe(before);
  });

  it("a stop from another server ends this one's loop on its next poll", async () => {
    const a = setup({ pid: 1 });
    await a.watcher.start();
    const b = setup({ pid: 2, home: a.home, downloads: a.downloads });
    b.watcher.stop();
    a.put("Basic_LinkedInDataExport_10-20-2026.zip");
    const before = a.timers.length;
    await a.watcher.poll();
    expect(a.store.status().connected).toBe(false);
    expect(a.timers.length).toBe(before);
  });
});
