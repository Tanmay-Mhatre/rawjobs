import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the network and the install itself are faked; judge() and the update file are the real ones.
const fake = vi.hoisted(() => ({
  manifest: { version: "99.0.0", minVersion: "0.0.0", critical: false, notes: "", date: "2026-10-12" } as Record<string, unknown>,
  fetchError: null as Error | null,
  startUpdate: vi.fn(async () => {}),
  downloadAhead: vi.fn(async () => {}),
}));
vi.mock("@rawjobs/core/update", async (importActual) => ({
  ...(await importActual<typeof import("@rawjobs/core/update")>()),
  releaseBase: async () => "https://releases.example/latest",
  fetchManifest: async () => {
    if (fake.fetchError) throw fake.fetchError;
    return { app: "rawjobs", bundleFile: "b.tar.gz", bundleSha256: "0", nodeVersion: "v24.0.0", nodeSha256: {}, ...fake.manifest };
  },
  startUpdate: fake.startUpdate,
  downloadAhead: fake.downloadAhead,
}));

const { createUpdater } = await import("../src/updater");
const { readUpdateFile, writeUpdateFile } = await import("@rawjobs/core/update");
const { APP_VERSION } = await import("@rawjobs/core");

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rawjobs-updater-"));
  fake.fetchError = null;
  fake.manifest = { version: "99.0.0", minVersion: "0.0.0", critical: false, notes: "", date: "2026-10-12" };
  fake.startUpdate.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

describe("the updater", () => {
  it("says plainly when GitHub can't be reached, and is idle again after", async () => {
    fake.fetchError = new TypeError("fetch failed");
    const u = createUpdater({ home, isBusy: () => false, exit: () => {} });
    expect(await u.check()).toBeNull();
    expect(u.status()).toMatchObject({ state: "idle", error: expect.stringMatching(/Couldn't reach GitHub/) });
  });

  it("installs at once when nothing is running, then hands over to the new version", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const u = createUpdater({ home, isBusy: () => false, exit });
    await u.apply();
    expect(fake.startUpdate).toHaveBeenCalledOnce();
    expect(u.updating()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(exit).toHaveBeenCalledOnce();
  });

  it("waits for a running scan, installs once it's done, and only once", async () => {
    vi.useFakeTimers();
    let busy = true;
    const pauseBackground = vi.fn();
    const u = createUpdater({ home, isBusy: () => busy, pauseBackground, exit: () => {} });
    await u.apply();
    await u.apply();
    expect(u.status().state).toBe("waiting");
    // A background check is asked to pause right away: the update doesn't wait hours for it.
    expect(pauseBackground).toHaveBeenCalledOnce();
    expect(fake.startUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.startUpdate).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.startUpdate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.startUpdate).toHaveBeenCalledOnce();
  });

  it("asks for the install line when this version is too old to update by itself", async () => {
    fake.manifest = { ...fake.manifest, minVersion: "98.0.0" };
    const u = createUpdater({ home, isBusy: () => false, exit: () => {} });
    await u.apply();
    expect(fake.startUpdate).not.toHaveBeenCalled();
    expect(u.status().error).toMatch(/too old/);
  });

  it("doesn't offer a version that went back by itself, but tries it again when you ask", async () => {
    vi.useFakeTimers();
    writeUpdateFile(home, { skip: ["99.0.0"] });
    const u = createUpdater({ home, isBusy: () => false, exit: () => {}, installed: true });
    await u.check();
    expect(u.status()).toMatchObject({ available: null, skipped: { version: "99.0.0" } });
    expect(u.updateHint()).toBeNull();
    // Settings → About → Try 99.0.0 again.
    const res = { statusCode: 0, setHeader: () => {}, end: vi.fn() };
    await u.route("/api/update/retry", { method: "POST" } as never, res as never, async () => "");
    expect(readUpdateFile(home).skip).toEqual([]);
    expect(fake.startUpdate).toHaveBeenCalledOnce();
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toMatchObject({ state: "updating", available: { version: "99.0.0" }, skipped: null });
  });
});

describe("the updater's lifetime and release notes", () => {
  /** GET /api/update/changelog, as the dashboard reads it. */
  async function changelog(installed: boolean) {
    const res = { statusCode: 0, setHeader: () => {}, end: vi.fn() };
    await createUpdater({ home, isBusy: () => false, exit: () => {}, installed }).route("/api/update/changelog", { method: "GET" } as never, res as never, async () => "");
    return JSON.parse(res.end.mock.calls[0]![0] as string) as { current: string; entries: unknown[]; upcoming: { version: string } | null };
  }
  const latest = { version: "99.0.0", notes: "Faster scans", critical: false, date: "2026-12-01", minVersion: "0.0.0", changes: [] };

  it("start() records when this version was installed, once, and stop() leaves no timer behind", () => {
    vi.useFakeTimers();
    const u = createUpdater({ home, isBusy: () => false, exit: () => {}, installed: true });
    u.start();
    const first = readUpdateFile(home).installed;
    expect(first?.version).toBe(APP_VERSION);
    vi.setSystemTime(Date.now() + 86_400_000);
    u.start();
    expect(readUpdateFile(home).installed).toEqual(first);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    u.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("start() does nothing in a copy that isn't installed (a checkout)", () => {
    vi.useFakeTimers();
    const u = createUpdater({ home, isBusy: () => false, exit: () => {}, installed: false });
    u.start();
    expect(readUpdateFile(home).installed).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the changelog shows the waiting version only to an installed copy, and only when it's newer", async () => {
    writeUpdateFile(home, { latest });
    expect(await changelog(true)).toMatchObject({ current: APP_VERSION, upcoming: { version: "99.0.0", notes: "Faster scans", critical: false } });
    expect((await changelog(false)).upcoming).toBeNull();
    writeUpdateFile(home, { latest: { ...latest, version: APP_VERSION } });
    expect((await changelog(true)).upcoming).toBeNull();
  });

  it("readChangelog() is empty in a checkout, which ships no changelog.json", async () => {
    const { readChangelog } = await import("../src/updater");
    expect(readChangelog()).toEqual([]);
    expect((await changelog(true)).entries).toEqual([]);
  });
});
