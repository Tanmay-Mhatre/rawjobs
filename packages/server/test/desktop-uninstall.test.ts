import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `rawjobs uninstall`, `update` and `shortcuts` as an installed copy runs them, in a temp RawJobs
// folder: the scheduler, the shortcuts and every program they start are stubbed, so nothing on this
// computer is touched.
const fake = vi.hoisted(() => ({
  spawned: [] as { cmd: string; args: string[] }[],
  quiet: [] as { cmd: string; args: string[] }[],
  home: "",
  removeSchedule: vi.fn(),
  removeDailySummary: vi.fn(),
  removeShortcuts: vi.fn(),
  makeShortcuts: vi.fn(() => ({ ok: true, menu: "/menu/rawjobs.desktop", desktop: "/Desktop/rawjobs.desktop" })),
}));

vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: (cmd: string, args: string[]) => {
    fake.spawned.push({ cmd, args });
    return { unref: () => {} };
  },
  spawnSync: (cmd: string, args: string[]) => {
    fake.quiet.push({ cmd, args });
    return { status: 0, stdout: "", stderr: "" };
  },
}));
vi.mock("node:os", async (orig) => ({ ...(await orig<typeof import("node:os")>()), homedir: () => fake.home }));
vi.mock("../src/shortcuts", () => ({ removeShortcuts: fake.removeShortcuts, makeShortcuts: fake.makeShortcuts }));

const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

/** desktop.ts as an installed copy (`bundled`) or a checkout of the source. */
async function load(bundled: boolean) {
  vi.resetModules();
  vi.doMock("@rawjobs/core", async (orig) => ({
    ...(await orig<typeof import("@rawjobs/core")>()),
    BUNDLED: bundled,
    removeSchedule: fake.removeSchedule,
    removeDailySummary: fake.removeDailySummary,
  }));
  return import("../src/desktop");
}

let home: string;
const out: string[] = [];
const err: string[] = [];
beforeEach(() => {
  fake.home = mkdtempSync(join(tmpdir(), "rawjobs-uninstall-"));
  home = join(fake.home, "RawJobs");
  for (const d of ["app/versions/1.0.0", "runtime", "bin", "logs", "icons", "profile", "data", "backups"]) mkdirSync(join(home, d), { recursive: true });
  for (const f of ["state.json", "updates.json", "shortcuts.json", "rawjobs.config.local.yaml", "profile/resume.md", "data/jobs.json"]) writeFileSync(join(home, f), "{}");
  vi.stubEnv("RAWJOBS_HOME", home);
  vi.stubEnv("RAWJOBS_LAUNCHER", join(home, "bin/rawjobs"));
  fake.spawned.length = 0;
  fake.quiet.length = 0;
  out.length = 0;
  err.length = 0;
  for (const f of [fake.removeSchedule, fake.removeDailySummary, fake.removeShortcuts, fake.makeShortcuts]) f.mockClear();
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  onPlatform("linux");
});
afterEach(() => {
  onPlatform(realPlatform);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock("@rawjobs/core");
  rmSync(fake.home, { recursive: true, force: true });
});

describe("rawjobs uninstall", () => {
  it("refuses in a copy of the source: there's nothing installed", async () => {
    const { uninstall } = await load(false);
    expect(await uninstall(["--keep-data"])).toBe(2);
    expect(err.join("\n")).toMatch(/copy of the RawJobs source/);
    expect(existsSync(join(home, "app"))).toBe(true);
    expect(fake.removeSchedule).not.toHaveBeenCalled();
  });

  it("--keep-data removes the program and its scheduling, and keeps your config, profile and data", async () => {
    const { uninstall } = await load(true);
    expect(await uninstall(["--keep-data"])).toBe(0);
    expect(readdirSync(home).sort()).toEqual(["backups", "data", "profile", "rawjobs.config.local.yaml"]);
    expect(fake.removeSchedule).toHaveBeenCalledOnce();
    expect(fake.removeDailySummary).toHaveBeenCalledOnce();
    expect(fake.removeShortcuts).toHaveBeenCalledWith(home);
    // Out of start-at-login (Linux: the systemd user unit).
    expect(fake.quiet).toContainEqual({ cmd: "systemctl", args: ["--user", "disable", "--now", "rawjobs.service"] });
    expect(out.join("\n")).toMatch(/Your profile, tracking and scan data are still in/);
  });

  it("--delete-data removes the whole RawJobs folder", async () => {
    const { uninstall } = await load(true);
    expect(await uninstall(["--delete-data"])).toBe(0);
    expect(existsSync(home)).toBe(false);
    expect(out.join("\n")).toMatch(/is deleted/);
  });

  it("stops the server state.json names, but never itself", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    writeFileSync(join(home, "state.json"), JSON.stringify({ port: 4317, pid: 999_999, version: "1.0.0", startedAt: "" }));
    const { uninstall } = await load(true);
    await uninstall(["--keep-data"]);
    expect(kill).toHaveBeenCalledWith(999_999);

    kill.mockClear();
    mkdirSync(join(home, "app"));
    writeFileSync(join(home, "state.json"), JSON.stringify({ port: 4317, pid: process.pid, version: "1.0.0", startedAt: "" }));
    await uninstall(["--keep-data"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("goes on when the scheduler can't be reached", async () => {
    fake.removeSchedule.mockImplementationOnce(() => {
      throw new Error("no scheduler");
    });
    const { uninstall } = await load(true);
    expect(await uninstall(["--keep-data"])).toBe(0);
    expect(existsSync(join(home, "app"))).toBe(false);
  });

  it("on Windows, leaves the deleting to a cleanup that runs after it exits (node.exe is in use)", async () => {
    onPlatform("win32");
    const { uninstall } = await load(true);
    expect(await uninstall(["--keep-data"])).toBe(0);
    expect(fake.quiet.find((c) => c.cmd === "powershell.exe")?.args.at(-1)).toContain("Unregister-ScheduledTask -TaskName 'RawJobs Server'");
    const cleanup = fake.spawned.find((c) => c.cmd === "cmd.exe")!;
    const script = cleanup.args.at(-1)!;
    expect(script).toMatch(/^ping -n 3 127\.0\.0\.1 >nul & /);
    for (const p of ["app", "runtime", "bin", "state.json"]) expect(script).toContain(`rmdir /s /q "${join(home, p)}"`);
    for (const p of ["profile", "data", "rawjobs.config.local.yaml"]) expect(script).not.toContain(join(home, p));
    // Nothing is deleted before it exits.
    expect(existsSync(join(home, "runtime"))).toBe(true);
  });
});

describe("rawjobs update and rawjobs shortcuts", () => {
  it("update refuses in a copy of the source, and says how to update it", async () => {
    const { updateCommand } = await load(false);
    expect(await updateCommand([])).toBe(2);
    expect(err.join("\n")).toMatch(/update it with git pull/);
  });

  it("shortcuts refuses in a copy of the source", async () => {
    const { shortcutsCommand } = await load(false);
    expect(shortcutsCommand([])).toBe(2);
    expect(fake.makeShortcuts).not.toHaveBeenCalled();
  });

  it("shortcuts makes them with this copy's launcher and prints where", async () => {
    const { shortcutsCommand } = await load(true);
    expect(shortcutsCommand(["--desktop"])).toBe(0);
    expect(fake.makeShortcuts).toHaveBeenCalledWith(home, join(home, "bin/rawjobs"), expect.objectContaining({ desktop: true }));
    expect(out).toEqual(["Shortcut: /menu/rawjobs.desktop", "Shortcut: /Desktop/rawjobs.desktop"]);
  });

  it("shortcuts says why they couldn't be made", async () => {
    fake.makeShortcuts.mockReturnValueOnce({ ok: false, menu: null as never, desktop: null as never, error: "Access is denied." } as never);
    const { shortcutsCommand } = await load(true);
    expect(shortcutsCommand([])).toBe(1);
    expect(err.join("\n")).toBe("Couldn't make the RawJobs shortcuts: Access is denied.");
  });
});
