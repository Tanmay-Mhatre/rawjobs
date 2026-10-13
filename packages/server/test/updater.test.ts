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
    const u = createUpdater({ home, isBusy: () => busy, exit: () => {} });
    await u.apply();
    await u.apply();
    expect(u.status().state).toBe("waiting");
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
