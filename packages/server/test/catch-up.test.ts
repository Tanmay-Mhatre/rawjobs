import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordScheduledRun } from "@rawjobs/core";
import { CHECK_EVERY_MS, SETTLE_MS, watchMissedScans } from "../src/catch-up";

/** A data folder with a 10:00 schedule saved long ago, and a clock starting at 09:00 on 14 Nov. */
function setup(o: { online?: boolean; busy?: boolean; platform?: NodeJS.Platform } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "rj-catchup-"));
  const file = join(dataDir, "schedule.json");
  writeFileSync(file, JSON.stringify({ times: ["10:00"], scope: "mine" }));
  utimesSync(file, new Date(2026, 9, 1), new Date(2026, 9, 1));
  recordScheduledRun(dataDir, { startedAt: new Date(2026, 10, 3, 10).toISOString(), scope: "mine", ok: true });
  let t = new Date(2026, 10, 14, 9).getTime();
  const calls: string[][] = [];
  let online = o.online ?? true;
  const w = watchMissedScans({
    dataDir,
    busy: () => o.busy ?? false,
    cli: async (args) => {
      calls.push(args);
      return { code: 0, stdout: args[1] === "repair" ? '{"ok":true,"fixed":[]}' : '{"ok":true}', stderr: "" };
    },
    online: async () => online,
    log: () => {},
    now: () => t,
    platform: o.platform ?? "linux",
  });
  w.stop();
  return {
    dataDir,
    calls,
    runs: () => calls.filter((c) => c[1] === "run"),
    goOnline: () => (online = true),
    advance: async (ms: number) => {
      t += ms;
      await w.tick();
    },
  };
}

describe("catching up on a missed scheduled scan", () => {
  it("waits for the laptop to settle, then starts one catch-up and doesn't start it twice", async () => {
    const s = setup();
    await s.advance(60_000);
    expect(s.runs()).toEqual([]);
    await s.advance(SETTLE_MS);
    expect(s.runs()).toEqual([["schedule", "run", "--catch-up", "--data", s.dataDir]]);
    await s.advance(CHECK_EVERY_MS);
    expect(s.runs()).toHaveLength(1);
  });

  it("offline: doesn't start until the internet answers, then looks again within a minute", async () => {
    const s = setup({ online: false });
    await s.advance(SETTLE_MS);
    expect(s.runs()).toEqual([]);
    s.goOnline();
    await s.advance(60_000);
    expect(s.runs()).toHaveLength(1);
  });

  it("leaves it while a scan is running", async () => {
    const s = setup({ busy: true });
    await s.advance(SETTLE_MS);
    expect(s.runs()).toEqual([]);
  });

  it("nothing missed: nothing started", async () => {
    const s = setup();
    recordScheduledRun(s.dataDir, { startedAt: new Date(2026, 10, 13, 10).toISOString(), scope: "mine", ok: true });
    await s.advance(SETTLE_MS);
    expect(s.runs()).toEqual([]);
  });

  it("Windows: checks the tasks' times at start and again after a wake", async () => {
    const s = setup({ platform: "win32" });
    await s.advance(SETTLE_MS);
    const repairs = () => s.calls.filter((c) => c[1] === "repair").length;
    expect(repairs()).toBe(1);
    // Awake: a tick a minute, and no second look at the tasks.
    for (let i = 0; i < CHECK_EVERY_MS / 60_000; i++) await s.advance(60_000);
    expect(repairs()).toBe(1);
    // Asleep for an hour: the next tick sees the gap, and looks once the laptop has settled.
    await s.advance(3_600_000);
    await s.advance(SETTLE_MS);
    expect(repairs()).toBe(2);
  });
});
