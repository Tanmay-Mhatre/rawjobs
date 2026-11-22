import { describe, expect, it } from "vitest";
import { scheduledNotice } from "../src/components/ScheduledScanNotice";
import type { ScheduledRun, ScheduleStatus } from "../src/lib/automation";

const run = (startedAt: string, r: Partial<ScheduledRun> = {}): ScheduledRun => ({ startedAt, scope: "mine", ok: true, ...r });
const status = (runs: ScheduledRun[], problem?: string) => ({ ok: true, installed: true, supported: true, platform: "win32", runs, ...(problem ? { problem } : {}) }) as unknown as ScheduleStatus;

describe("the Radar's scheduled-scan notice", () => {
  it("says nothing while the newest run finished, is still going, or was skipped", () => {
    expect(scheduledNotice(status([run("2026-11-22T08:00:00Z"), run("2026-11-21T08:00:00Z", { ok: false, error: "fetch failed" })]))).toBeNull();
    expect(scheduledNotice(status([run("2026-11-22T08:00:00Z", { ok: false, running: true })]))).toBeNull();
    expect(scheduledNotice(status([run("2026-11-22T08:00:00Z", { ok: false, error: "Another scan was already running." })]))).toBeNull();
    expect(scheduledNotice(null)).toBeNull();
  });

  it("names the run that didn't finish and why, keyed to that run", () => {
    const n = scheduledNotice(status([run("2026-11-22T08:00:00Z", { ok: false, error: "getaddrinfo ENOTFOUND boards.greenhouse.io" })]));
    expect(n?.title).toMatch(/^Your .+ scheduled scan didn't finish\.$/);
    expect(n?.detail).toBe("No internet connection during the scan. It tries again at the next scheduled time.");
    expect(n?.key).toBe("2026-11-22T08:00:00Z");
  });

  it("counts failures in a row, and says when the schedule itself is gone", () => {
    const failed = { ok: false, error: "ENOSPC: no space left on device" };
    expect(scheduledNotice(status([run("2026-11-22T20:00:00Z", failed), run("2026-11-22T08:00:00Z", failed), run("2026-11-21T08:00:00Z")]))?.title).toBe("The last 2 scheduled scans didn't finish.");
    const lost = scheduledNotice(status([], "The scheduled task is missing from Windows Task Scheduler. Save the schedule again to recreate it."));
    expect(lost).toMatchObject({ title: "Scheduled scans aren't running.", fix: true });
  });
});
