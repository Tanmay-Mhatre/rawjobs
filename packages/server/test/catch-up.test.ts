import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { OUTBOX_FILE, OVERDUE_RUN, readScheduledRuns, recordScheduledRun } from "@rawjobs/core";
import { CHECK_EVERY_MS, flushAlerts, OVERDUE_GRACE_MS, SETTLE_MS, watchMissedScans } from "../src/catch-up";

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

describe("a scheduled scan far past its time limit", () => {
  it("is asked to stop, then ended when it doesn't, and its run says so; no catch-up starts meanwhile", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "rj-overdue-"));
    writeFileSync(join(dataDir, "schedule.json"), JSON.stringify({ times: ["10:00"], scope: "mine" }));
    let t = new Date(2026, 10, 14, 9).getTime();
    // A scheduled "mine" scan started 6 h ago and still holds the lock (a sleeping child stands in for it).
    const startedAt = new Date(t - 6 * 3_600_000).toISOString();
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
    const pid = holder.pid!;
    recordScheduledRun(dataDir, { startedAt, scope: "mine", ok: false, pid });
    writeFileSync(join(dataDir, "scan.lock"), String(pid));
    const killed: number[] = [];
    const calls: string[][] = [];
    const w = watchMissedScans({
      dataDir,
      busy: () => false,
      cli: async (args) => {
        calls.push(args);
        return { code: 0, stdout: '{"ok":true,"fixed":[]}', stderr: "" };
      },
      online: async () => true,
      log: () => {},
      now: () => t,
      kill: (p) => killed.push(p),
    });
    w.stop();
    try {
      t += SETTLE_MS;
      await w.tick();
      expect(existsSync(join(dataDir, "scan-stop"))).toBe(true);
      expect(killed).toEqual([]);
      // It gets a while to save and stop; looked at every minute meanwhile.
      for (let i = 0; i < OVERDUE_GRACE_MS / 60_000; i++) {
        t += 60_000;
        utimesSync(join(dataDir, "scan.lock"), new Date(), new Date());
        await w.tick();
      }
      t += 60_000;
      await w.tick();
      expect(killed).toEqual([pid]);
      const run = readScheduledRuns(dataDir).find((r) => r.startedAt === startedAt)!;
      expect(run).toMatchObject({ ok: false, error: OVERDUE_RUN });
      expect(run.finishedAt).toBeDefined();
      expect(calls.filter((c) => c[1] === "run")).toEqual([]);
    } finally {
      holder.kill();
    }
  });
});

describe("sending alerts a scan left in the outbox", () => {
  const secrets = { token: "123456:abc", chatId: "42" };
  const withOutbox = () => {
    const dataDir = mkdtempSync(join(tmpdir(), "rj-flush-"));
    writeFileSync(join(dataDir, OUTBOX_FILE), JSON.stringify({ messages: [{ text: "waiting", at: new Date().toISOString() }] }));
    return dataDir;
  };
  const telegram = () => {
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }) as unknown as typeof fetch;
    return { sent, fetchImpl };
  };

  it("sends them at server start", async () => {
    const dataDir = withOutbox();
    const t = telegram();
    expect(await flushAlerts(dataDir, { secrets, enabled: true, fetchImpl: t.fetchImpl })).toBe("sent");
    expect(t.sent).toEqual(["waiting"]);
    expect(existsSync(join(dataDir, OUTBOX_FILE))).toBe(false);
  });

  it("server start flush skips while scan.lock is held", async () => {
    const dataDir = withOutbox();
    // Another live process (this test's parent) holds the scan lock.
    writeFileSync(join(dataDir, "scan.lock"), String(process.ppid));
    const t = telegram();
    expect(await flushAlerts(dataDir, { secrets, enabled: true, fetchImpl: t.fetchImpl })).toBeNull();
    expect(t.sent).toEqual([]);
    expect(existsSync(join(dataDir, OUTBOX_FILE))).toBe(true);
  });

  it("alerts off: leaves them", async () => {
    const dataDir = withOutbox();
    expect(await flushAlerts(dataDir, { secrets, enabled: false })).toBe("off");
    expect(existsSync(join(dataDir, OUTBOX_FILE))).toBe(true);
  });

  it("the watcher flushes once after start, and again only after a busy lock", async () => {
    const answers: (string | null)[] = [null, "sent"];
    let flushes = 0;
    let t = 0;
    const w = watchMissedScans({
      dataDir: mkdtempSync(join(tmpdir(), "rj-flush-")),
      busy: () => false,
      cli: async () => ({ code: 0, stdout: "{}", stderr: "" }),
      online: async () => true,
      log: () => {},
      now: () => t,
      platform: "linux",
      flush: async () => {
        flushes++;
        return answers.length ? (answers.shift() as string | null) : "nothing";
      },
    });
    w.stop();
    // One-minute ticks, as the server runs them.
    const minutes = async (n: number) => {
      for (let i = 0; i < n; i++) {
        t += 60_000;
        await w.tick();
      }
    };
    await minutes(SETTLE_MS / 60_000);
    expect(flushes).toBe(1);
    await minutes((3 * CHECK_EVERY_MS) / 60_000);
    expect(flushes).toBe(2);
  });
});
