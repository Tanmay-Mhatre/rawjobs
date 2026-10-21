import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The beacon, GitHub, the download and Telegram are faked; the update file and judge() are real.
const fake = vi.hoisted(() => ({
  beacon: { same: false, etag: '"1"', beacon: { stable: { version: "99.0.0" } } } as Record<string, unknown>,
  beaconError: null as Error | null,
  manifest: { version: "99.0.0", minVersion: "0.0.0", critical: false, notes: "", date: "2026-10-19", changes: [{ type: "fixed", text: "Alerts after a restart" }] } as Record<string, unknown>,
  fetchManifest: vi.fn(),
  downloadAhead: vi.fn(),
  sendTelegram: vi.fn(async (_text: string, _secrets: unknown) => {}),
  telegramOn: true,
}));
vi.mock("@rawjobs/core/update", async (importActual) => {
  const actual = await importActual<typeof import("@rawjobs/core/update")>();
  return {
    ...actual,
    releaseBase: async () => "https://releases.example/latest",
    fetchBeacon: async (etag?: string) => {
      if (fake.beaconError) throw fake.beaconError;
      return etag && etag === fake.beacon.etag ? { same: true } : fake.beacon;
    },
    fetchManifest: fake.fetchManifest,
    downloadAhead: fake.downloadAhead,
  };
});
vi.mock("@rawjobs/core", async (importActual) => ({
  ...(await importActual<typeof import("@rawjobs/core")>()),
  loadConfig: () => ({ config: { alerts: { telegram: fake.telegramOn } }, path: "x" }),
  telegramSecrets: () => ({ token: "1:abc", chatId: "42" }),
  sendTelegram: fake.sendTelegram,
}));

const { createUpdater, updateMessage } = await import("../src/updater");
const { readUpdateFile, writeUpdateFile } = await import("@rawjobs/core/update");

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rawjobs-beacon-"));
  fake.beacon = { same: false, etag: '"1"', beacon: { stable: { version: "99.0.0" } } };
  fake.beaconError = null;
  fake.telegramOn = true;
  fake.fetchManifest.mockReset().mockImplementation(async () => ({ app: "rawjobs", bundleFile: "b.tar.gz", bundleSha256: "0", nodeVersion: "v24.0.0", nodeSha256: {}, ...fake.manifest }));
  // "Downloading" = recording it as ready, as the real downloadAhead does.
  fake.downloadAhead.mockReset().mockImplementation(async (h: string, _base: string, m: { version: string }) => writeUpdateFile(h, { ready: { version: m.version, node: "n" } }));
  fake.sendTelegram.mockClear();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const updater = () => createUpdater({ home, isBusy: () => false, exit: () => {}, installed: true });

describe("watching the beacon", () => {
  it("gets and downloads a newer version the beacon names, and says so once on Telegram", async () => {
    const u = updater();
    await u.look();
    expect(fake.fetchManifest).toHaveBeenCalledOnce();
    expect(fake.downloadAhead).toHaveBeenCalledOnce();
    expect(u.updateHint()).toEqual({ version: "99.0.0", critical: false });
    expect(u.status().available).toMatchObject({ version: "99.0.0", ready: true, changes: [{ type: "fixed" }] });
    expect(fake.sendTelegram).toHaveBeenCalledOnce();
    expect(fake.sendTelegram.mock.calls[0]![0]).toMatch(/Update ready<\/b>\n\nRawJobs <b>99\.0\.0<\/b> is ready to install/);
    // The beacon hasn't changed: no GitHub, no download, no second message.
    await u.look();
    expect(fake.fetchManifest).toHaveBeenCalledOnce();
    expect(fake.downloadAhead).toHaveBeenCalledOnce();
    expect(fake.sendTelegram).toHaveBeenCalledOnce();
  });

  it("leaves GitHub alone while the beacon names nothing newer", async () => {
    fake.beacon = { same: false, etag: '"2"', beacon: { stable: { version: "0.0.1" } } };
    await updater().look();
    expect(fake.fetchManifest).not.toHaveBeenCalled();
  });

  it("sends nothing on Telegram when alerts are off, or the update message is turned off", async () => {
    fake.telegramOn = false;
    await updater().look();
    expect(fake.sendTelegram).not.toHaveBeenCalled();
    fake.telegramOn = true;
    writeUpdateFile(home, { telegram: false, notified: undefined });
    await updater().look();
    expect(fake.sendTelegram).not.toHaveBeenCalled();
  });

  it("waits longer each time the beacon can't be read, and asks GitHub after hours without it", async () => {
    fake.beaconError = new TypeError("fetch failed");
    // It read the beacon a minute ago (a copy that never read anything asks GitHub at once).
    writeUpdateFile(home, { beacon: { checkedAt: new Date(Date.now() - 60_000).toISOString() } });
    const u = updater();
    const waits = [await u.look(), await u.look(), await u.look()];
    expect(waits).toEqual([5 * 60_000, 10 * 60_000, 20 * 60_000]);
    expect(fake.fetchManifest).not.toHaveBeenCalled();
    writeUpdateFile(home, { beacon: { checkedAt: new Date(Date.now() - 7 * 3_600_000).toISOString() } });
    await u.look();
    expect(fake.fetchManifest).toHaveBeenCalledOnce();
  });

  it("writes the beacon to updates.json only when it changed, or hours after the last time", async () => {
    fake.beacon = { same: false, etag: '"2"', beacon: { stable: { version: "0.0.1" } } };
    const u = updater();
    await u.look();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    writeUpdateFile(home, { beacon: { ...readUpdateFile(home).beacon!, checkedAt: hourAgo } });
    await u.look();
    expect(readUpdateFile(home).beacon!.checkedAt).toBe(hourAgo);
    // A new beacon is written at once.
    fake.beacon = { same: false, etag: '"3"', beacon: { stable: { version: "0.0.2" } } };
    await u.look();
    expect(readUpdateFile(home).beacon).toMatchObject({ etag: '"3"', stable: "0.0.2" });
    expect(readUpdateFile(home).beacon!.checkedAt).not.toBe(hourAgo);
    // Hours after it was written: written again, for after a restart.
    const old = new Date(Date.now() - 7 * 3_600_000).toISOString();
    writeUpdateFile(home, { beacon: { ...readUpdateFile(home).beacon!, checkedAt: old } });
    await u.look();
    expect(readUpdateFile(home).beacon!.checkedAt).not.toBe(old);
  });

  it("counts the hours without the beacon from when it last read it, not when it last wrote it", async () => {
    fake.beacon = { same: false, etag: '"2"', beacon: { stable: { version: "0.0.1" } } };
    const u = updater();
    await u.look();
    fake.beaconError = new TypeError("fetch failed");
    writeUpdateFile(home, { beacon: { ...readUpdateFile(home).beacon!, checkedAt: new Date(Date.now() - 7 * 3_600_000).toISOString() } });
    await u.look();
    expect(fake.fetchManifest).not.toHaveBeenCalled();
  });

  it("never looks when watching is off", async () => {
    writeUpdateFile(home, { mode: "off" });
    await updater().look();
    expect(fake.fetchManifest).not.toHaveBeenCalled();
    expect(readUpdateFile(home).beacon).toBeUndefined();
  });
});

describe("the Telegram message", () => {
  it("names the version, and says a required one is required", () => {
    expect(updateMessage("0.6.1<b>", false)).toBe(
      "⬆️ <b>Update ready</b>\n\nRawJobs <b>0.6.1&lt;b&gt;</b> is ready to install.\nNothing changes until you do.\n\n👉 <i>Open RawJobs on your computer and click Update.</i>",
    );
    expect(updateMessage("0.6.2", true)).toBe("⚠️ <b>Update required</b>\n\nRawJobs <b>0.6.2</b> is ready to install.\n\n👉 <i>Open RawJobs on your computer and click Update.</i>");
  });
});
