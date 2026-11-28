import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableJobs, digest, findTelegramChat, finishedMessage, looksLikeToken, scheduledFailedMessage, maskToken, saveTelegramSecrets, sendTelegram, telegramSecrets } from "../src/notify";
import { acquireScanLock, releaseScanLock, scanLockHeld } from "../src/scan";
import {
  installSchedule,
  lastDueSlot,
  missedScan,
  nextRunAt,
  overdueScheduledRun,
  readScheduledRuns,
  recordScheduledRun,
  refreshSchedules,
  removeSchedule,
  repairScheduleTimes,
  runScheduleNow,
  type ScheduledRun,
  scheduledRunKind,
  scheduledRunsNow,
  UNFINISHED_RUN,
  scheduleStatus,
  takeRunRequest,
  validateSchedule,
} from "../src/schedule";
import type { Job } from "../src/schema";
import { makeJob } from "./helpers";

const job = (title: string, score: number, extra: Partial<Job> = {}): Job =>
  makeJob({
    id: `greenhouse:co:${title}`,
    company: "Co <&>",
    title,
    location: "Dubai, UAE; Remote",
    url: `https://example.com/${encodeURIComponent(title)}`,
    score,
    why: { title: 30, location: 20, keywords: [], keywordPoints: 0, freshness: 10 },
    ...extra,
  });

describe("digest", () => {
  it("says nothing when there's nothing new", () => {
    expect(digest([], { minScore: 70, scope: "mine" })).toBeUndefined();
  });

  it("is a header, the counts and what to do, a blank line apart: no jobs, scores or links", () => {
    expect(digest([job("PM", 60), job("Head of Product", 85), job("<b>", 90)], { minScore: 70, scope: "mine" })).toBe(
      "💼 <b>New jobs · Your scan</b>\n\n<b>3</b> new jobs · <b>2</b> strong fits\n\n👉 <i>Open RawJobs on your computer to see them.</i>",
    );
  });

  it("uses the singular for one, and never a 0", () => {
    expect(digest([job("Head of Product", 85)], { minScore: 70, scope: "mine" })).toBe(
      "💼 <b>New jobs · Your scan</b>\n\n<b>1</b> new job · <b>1</b> strong fit\n\n👉 <i>Open RawJobs on your computer to see it.</i>",
    );
    expect(digest([job("PM", 60), job("PO", 50)], { minScore: 70, scope: "mine" })).toContain("\n<b>2</b> new jobs · no strong fits\n");
  });

  it("counts strong fits, not new jobs, with only_new off", () => {
    expect(digest([job("A", 80), job("B", 90)], { minScore: 70, onlyNew: false, scope: "all" })).toBe(
      "💼 <b>Strong fits · Every company</b>\n\n<b>2</b> strong fits\n\n👉 <i>Open RawJobs on your computer to see them.</i>",
    );
  });
});

describe("scheduledFailedMessage", () => {
  it("says a scheduled scan didn't finish, without details, and what to do", () => {
    expect(scheduledFailedMessage()).toBe("⚠️ <b>Scheduled scan didn't finish</b>\n\nYour earlier results are safe.\n\n👉 <i>Open RawJobs on your computer to see why and scan again.</i>");
  });
});

describe("finishedMessage", () => {
  it("says the scan finished, with the jobs available to apply", () => {
    expect(finishedMessage({ available: 17, scope: "mine" })).toBe("✅ <b>Your scan finished</b>\n\n<b>17</b> jobs available to apply\n\n👉 <i>Open RawJobs on your computer to see them.</i>");
    expect(finishedMessage({ available: 1, scope: "mine" })).toContain("\n<b>1</b> job available to apply\n");
    expect(finishedMessage({ available: 0, scope: "all" })).toBe(
      "✅ <b>Every company scan finished</b>\n\nNo new jobs in the last 2 days\n\n👉 <i>Open RawJobs on your computer to see your matches.</i>",
    );
  });

  it("says a scan stopped, and to finish it", () => {
    expect(finishedMessage({ available: 1, stopped: true, scope: "mine" })).toBe(
      "⏸ <b>Your scan stopped</b>\n\n<b>1</b> job available to apply\n\n👉 <i>Open RawJobs on your computer to see it and finish the scan.</i>",
    );
    expect(finishedMessage({ available: 0, stopped: true, scope: "mine" })).toBe(
      "⏸ <b>Your scan stopped</b>\n\nNo new jobs in the last 2 days\n\n👉 <i>Open RawJobs on your computer to finish the scan.</i>",
    );
  });
});

describe("availableJobs", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  it("counts open, ungated jobs first seen in the last 48 hours, whichever scan found them", () => {
    const jobs = [
      job("fresh", 80, { firstSeen: hoursAgo(3) }),
      job("yesterday", 50, { firstSeen: hoursAgo(30) }),
      job("old", 80, { firstSeen: hoursAgo(49) }),
      job("closed", 80, { firstSeen: hoursAgo(3), status: "closed" }),
      job("gated", 80, { firstSeen: hoursAgo(3), why: { ...job("x", 80).why, gate: "location" } }),
      job("stale posting", 80, { firstSeen: hoursAgo(3), postedAt: hoursAgo(24 * 40) }),
    ];
    expect(availableJobs(jobs, now).map((j) => j.title)).toEqual(["fresh", "yesterday"]);
  });
});

describe("telegram secrets and API", () => {
  it("keeps the token in profile/secrets.json, masks it for display, and checks its shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-tg-"));
    saveTelegramSecrets({ token: "123456789:AAFabcdefghijklmnopqrstuvwxyz0123456", bot: "@my_bot" }, dir);
    saveTelegramSecrets({ chatId: "42" }, dir);
    expect(telegramSecrets(dir)).toMatchObject({ token: "123456789:AAFabcdefghijklmnopqrstuvwxyz0123456", chatId: "42", bot: "@my_bot" });
    expect(maskToken(telegramSecrets(dir).token)).toBe("123456789:AAF…456");
    saveTelegramSecrets({ token: "", chatId: "" }, dir);
    expect(telegramSecrets(dir).token).toBeUndefined();
    expect(looksLikeToken("123456789:AAFabcdefghijklmnopqrstuvwxyz0123456")).toBe(true);
    expect(looksLikeToken("hello")).toBe(false);
  });

  it("finds the chat that messaged the bot, and sends HTML messages to it", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      const result = url.endsWith("/getUpdates") ? [{ message: { chat: { id: 99, type: "private", first_name: "Sam" } } }] : true;
      return new Response(JSON.stringify({ ok: true, result }));
    }) as typeof fetch;
    expect(await findTelegramChat("t:k", fake)).toEqual({ chatId: "99", name: "Sam" });
    await sendTelegram("<b>hi</b>", { token: "t:k", chatId: "99" }, fake);
    expect(calls[1]).toMatchObject({ url: "https://api.telegram.org/bott:k/sendMessage", body: { chat_id: "99", text: "<b>hi</b>", parse_mode: "HTML" } });
  });

  it("explains a bad token in plain words", async () => {
    const fake = (async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    await expect(sendTelegram("x", { token: "bad", chatId: "1" }, fake)).rejects.toThrow(/didn't accept that bot token/);
  });
});

describe("schedule", () => {
  it("validates times and scope", () => {
    expect(validateSchedule({ times: ["20:00", "08:00", "08:00"], scope: "mine" })).toEqual({ times: ["08:00", "20:00"], scope: "mine" });
    expect(() => validateSchedule({ times: ["8am"], scope: "mine" })).toThrow(/08:00/);
    expect(() => validateSchedule({ times: [], scope: "all" })).toThrow(/one to four/);
  });

  it("knows the next run", () => {
    const now = new Date(2026, 9, 8, 9, 0);
    expect(nextRunAt(["08:00", "20:00"], now)).toBe(new Date(2026, 9, 8, 20, 0).toISOString());
    expect(nextRunAt(["08:00"], now)).toBe(new Date(2026, 9, 9, 8, 0).toISOString());
  });

  it("Windows: registers a task that catches up missed runs, wakes the PC and runs without a window", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    const scripts: string[] = [];
    const exec = (_cmd: string, args: string[]) => {
      scripts.push(args.at(-1)!);
      return { status: 0, stdout: "", stderr: "" };
    };
    // An absolute path on any system (tests also run on Linux CI), with a quote PowerShell must escape.
    const repo = join(tmpdir(), "Repo It's");
    installSchedule({ repoRoot: repo, dataDir, exec, platform: "win32" }, { times: ["08:00", "20:00"], scope: "all" });
    const script = scripts[0]!;
    expect(script).toContain("Register-ScheduledTask -TaskName 'RawJobs Scan'");
    expect(script).toContain("-StartWhenAvailable");
    // A scan never wakes a sleeping laptop.
    expect(script).not.toContain("WakeToRun");
    // The scan stops itself at its deadline; the task's limit (which ends only conhost) is a backstop past it.
    expect(script).toContain("-ExecutionTimeLimit (New-TimeSpan -Hours 5)");
    expect(script).toContain("--deadline 230");
    expect(script).toContain("New-ScheduledTaskTrigger -Daily -At '08:00'");
    expect(script).toContain("New-ScheduledTaskTrigger -Daily -At '20:00'");
    // Each start in local wall-clock time, no UTC offset: the times follow the computer's time zone.
    expect(script).toContain("$x.StartBoundary = (Get-Date -Format 'yyyy-MM-dd') + 'T08:00:00'");
    expect(script).toContain("$x.StartBoundary = (Get-Date -Format 'yyyy-MM-dd') + 'T20:00:00'");
    expect(script).toContain("-Execute 'conhost.exe' -Argument '--headless ");
    expect(script).toContain("scan --scope all --notify --scheduled --data");
    // A quote in a path is doubled for PowerShell.
    expect(script).toContain(`-WorkingDirectory '${repo.replace(/'/g, "''")}'`);
    expect(JSON.parse(readFileSync(join(dataDir, "schedule.json"), "utf8"))).toEqual({ times: ["08:00", "20:00"], scope: "all" });

    // An installed copy keeps your config elsewhere: the scan runs there, the code stays where it is.
    const mine = join(tmpdir(), "My RawJobs");
    installSchedule({ repoRoot: repo, workDir: mine, dataDir, exec, platform: "win32" }, { times: ["08:00"], scope: "mine" });
    expect(scripts.at(-1)).toContain(`-WorkingDirectory '${mine}'`);
    expect(scripts.at(-1)).toContain(join(repo, "packages/cli/src/index.ts").replace(/'/g, "''"));

    removeSchedule({ repoRoot: repo, dataDir, exec, platform: "win32" });
    expect(scripts.at(-1)).toContain("-TaskName 'RawJobs Scan'");
    expect(existsSync(join(dataDir, "schedule.json"))).toBe(false);
  });

  it("macOS: writes a launch agent with each time; Linux: a persistent systemd timer", () => {
    const home = mkdtempSync(join(tmpdir(), "jh-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    const exec = () => ({ status: 0, stdout: "", stderr: "" });
    installSchedule({ repoRoot: "/repo", workDir: home, dataDir, exec, platform: "darwin", home }, { times: ["07:30"], scope: "mine" });
    const plist = readFileSync(join(home, "Library/LaunchAgents/com.rawjobs.scan.plist"), "utf8");
    expect(plist).toContain("<key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer>");
    expect(plist).toContain("<string>--notify</string>");
    expect(scheduleStatus({ repoRoot: "/repo", workDir: home, dataDir, exec, platform: "darwin", home }).installed).toBe(true);

    installSchedule({ repoRoot: "/repo", workDir: home, dataDir, exec, platform: "linux", home }, { times: ["07:30", "19:00"], scope: "mine" });
    const timer = readFileSync(join(home, ".config/systemd/user/rawjobs-scan.timer"), "utf8");
    expect(timer).toContain("OnCalendar=*-*-* 07:30:00\nOnCalendar=*-*-* 19:00:00\nPersistent=true");
    // Stopped gracefully (SIGTERM saves the scan's progress) with time to save, before the backstop's SIGKILL.
    expect(plist).toContain("<key>ExitTimeOut</key><integer>60</integer>");
    // RawJobs logs the run itself (rotated, out of data/ so backups leave it out); launchd's file only catches what comes before.
    expect(plist).toContain(`<string>--log</string>\n    <string>${join(home, "logs", "schedule.log")}</string>`);
    expect(plist).toContain(`<key>StandardOutPath</key><string>${join(home, "logs", "launchd-scan.log")}</string>`);
    expect(plist).toContain("<string>--deadline</string>\n    <string>170</string>");
    const service = readFileSync(join(home, ".config/systemd/user/rawjobs-scan.service"), "utf8");
    expect(service).toContain("TimeoutStartSec=4h\nTimeoutStopSec=2min");
    expect(service).toContain("--deadline 170");
  });

  it("writes schedules from an older version again once, never while a scan holds the lock", () => {
    const home = mkdtempSync(join(tmpdir(), "jh-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    };
    const ctx = { repoRoot: "/repo", workDir: home, dataDir, exec, platform: "linux" as const, home };
    // Nothing installed: nothing to write, and it's current from now on.
    expect(refreshSchedules(ctx)).toBe(true);
    expect(calls).toEqual([]);
    rmSync(join(dataDir, "scheduler-format.json"));
    writeFileSync(join(dataDir, "schedule.json"), JSON.stringify({ times: ["07:30"], scope: "mine" }));
    writeFileSync(join(dataDir, "daily-summary.json"), JSON.stringify({ time: "08:00" }));
    writeFileSync(join(dataDir, "schedule.log"), "an older version's scan output");
    // A scan is running (a sleeping child holds the lock for it): later.
    const scan = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
    try {
      writeFileSync(join(dataDir, "scan.lock"), String(scan.pid));
      expect(refreshSchedules(ctx)).toBe(false);
      expect(existsSync(join(home, ".config/systemd/user/rawjobs-scan.service"))).toBe(false);
    } finally {
      scan.kill();
    }
    rmSync(join(dataDir, "scan.lock"));
    expect(refreshSchedules(ctx)).toBe(true);
    expect(readFileSync(join(home, ".config/systemd/user/rawjobs-scan.service"), "utf8")).toContain("--deadline 170");
    expect(existsSync(join(home, ".config/systemd/user/rawjobs-daily-summary.service"))).toBe(true);
    // The log an older version kept in data/ moves to logs/.
    expect(existsSync(join(dataDir, "schedule.log"))).toBe(false);
    expect(readFileSync(join(home, "logs/schedule.old.log"), "utf8")).toBe("an older version's scan output");
    // Once: the next start writes nothing.
    const n = calls.length;
    expect(refreshSchedules(ctx)).toBe(true);
    expect(calls).toHaveLength(n);
  });

  it("logs scheduled runs, newest first", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    recordScheduledRun(dataDir, { startedAt: "2026-10-08T04:00:00Z", scope: "mine", ok: true, matches: 3 });
    recordScheduledRun(dataDir, { startedAt: "2026-10-09T04:00:00Z", scope: "mine", ok: false, error: "offline" });
    expect(readScheduledRuns(dataDir).map((r) => r.startedAt)).toEqual(["2026-10-09T04:00:00Z", "2026-10-08T04:00:00Z"]);
  });
});

describe("catching up on a missed scan", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
  const run = (startedAt: Date, catchUp?: boolean): ScheduledRun => ({ startedAt: startedAt.toISOString(), scope: "mine", ok: true, ...(catchUp ? { catchUp } : {}) });

  it("finds the latest time that has come: today's, or yesterday's before it", () => {
    expect(lastDueSlot(["10:00"], at(14, 9))).toEqual(at(13, 10));
    expect(lastDueSlot(["10:00"], at(14, 10))).toEqual(at(14, 10));
    expect(lastDueSlot(["08:00", "20:00"], at(14, 12))).toEqual(at(14, 8));
  });

  it("ten days off, opened at 09:00 before a 10:00 scan: one catch-up for yesterday's time", () => {
    const runs = [run(at(3, 10))];
    expect(missedScan(["10:00"], runs, at(14, 9))).toEqual(at(13, 10));
    // Done once a scan started after that time.
    expect(missedScan(["10:00"], [run(at(14, 9, 3), true), ...runs], at(14, 9, 30))).toBeUndefined();
    // The catch-up stands in for today's 10:00 too, so the server doesn't start another…
    expect(missedScan(["10:00"], [run(at(14, 9, 3), true), ...runs], at(14, 10, 30))).toBeUndefined();
    // …and the 10:00 scan skips itself.
    expect(scheduledRunKind(["10:00"], [run(at(14, 9, 3), true)], undefined, at(14, 10)).skip).toMatch(/catch-up scan already ran/);
  });

  it("an on-time scan never stands in for a later time of the same day", () => {
    expect(missedScan(["08:00", "12:00"], [run(at(14, 8))], at(14, 12, 20))).toEqual(at(14, 12));
    expect(scheduledRunKind(["08:00", "12:00"], [run(at(14, 8))], undefined, at(14, 12)).skip).toBeUndefined();
  });

  it("a catch-up more than 3 hours before the time doesn't stand in for it", () => {
    expect(missedScan(["10:00"], [run(at(14, 6, 30), true)], at(14, 10, 30))).toEqual(at(14, 10));
    expect(scheduledRunKind(["10:00"], [run(at(14, 6, 30), true)], undefined, at(14, 10)).skip).toBeUndefined();
  });

  it("times before the schedule was saved were never due", () => {
    expect(missedScan(["10:00"], [], at(14, 11), at(14, 10, 30))).toBeUndefined();
    expect(missedScan(["10:00"], [], at(15, 11), at(14, 10, 30))).toEqual(at(15, 10));
  });

  it("a scheduled scan that starts late is a catch-up; Run now and the server say which they are", () => {
    expect(scheduledRunKind(["10:00"], [], undefined, at(14, 10, 1))).toEqual({ catchUp: false });
    expect(scheduledRunKind(["10:00"], [], undefined, at(14, 10, 30))).toEqual({ catchUp: true });
    // Run now is never skipped, even right after a catch-up.
    expect(scheduledRunKind(["10:00"], [run(at(14, 9, 3), true)], "run-now", at(14, 10))).toEqual({ catchUp: false });
    expect(scheduledRunKind(["10:00"], [], "catch-up", at(14, 9, 3))).toEqual({ catchUp: true });
  });

  it("Run now leaves a request the scan takes once, while it's fresh", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    const ctx = { repoRoot: "/repo", dataDir, exec: () => ({ status: 0, stdout: "", stderr: "" }), platform: "linux" as const, home: dataDir };
    runScheduleNow(ctx, "catch-up");
    expect(takeRunRequest(dataDir)).toBe("catch-up");
    expect(takeRunRequest(dataDir)).toBeUndefined();
    runScheduleNow(ctx);
    expect(takeRunRequest(dataDir, Date.now() + 11 * 60_000)).toBeUndefined();
  });

  it("Windows: saves a task again when its next run isn't at one of your times (a time zone change)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    writeFileSync(join(dataDir, "schedule.json"), JSON.stringify({ times: ["10:00"], scope: "mine" }));
    writeFileSync(join(dataDir, "daily-summary.json"), JSON.stringify({ time: "09:00" }));
    const scripts: string[] = [];
    let next = "11:30";
    const exec = (_cmd: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("NextRunTime.ToString('HH:mm')")) return { status: 0, stdout: script.includes("daily summary") ? "09:00\n" : `${next}\n`, stderr: "" };
      // activeNames: the current task is there.
      if (script.includes("ConvertTo-Json")) return { status: 0, stdout: '{"next":null}', stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const ctx = { repoRoot: "/repo", dataDir, exec, platform: "win32" as const };
    expect(repairScheduleTimes(ctx)).toEqual(["scheduled scan (11:30 → 10:00)"]);
    expect(scripts.filter((s) => s.includes("Register-ScheduledTask"))).toEqual([expect.stringContaining("-TaskName 'RawJobs Scan'")]);
    // Saving again leaves your settings (and when they were saved) alone.
    expect(JSON.parse(readFileSync(join(dataDir, "schedule.json"), "utf8"))).toEqual({ times: ["10:00"], scope: "mine" });
    next = "10:00";
    expect(repairScheduleTimes(ctx)).toEqual([]);
    expect(repairScheduleTimes({ ...ctx, platform: "darwin" })).toEqual([]);
  });
});

describe("scan lock", () => {
  it("lets one scan at a time hold a data folder, and takes over a lock left by a process that's gone", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-lock-"));
    expect(acquireScanLock(dataDir)).toBe(true);
    releaseScanLock(dataDir);
    expect(existsSync(join(dataDir, "scan.lock"))).toBe(false);
    // A process id that can't exist.
    writeFileSync(join(dataDir, "scan.lock"), "999999999");
    expect(acquireScanLock(dataDir)).toBe(true);
    // A live process (the test runner's parent) holds it.
    writeFileSync(join(dataDir, "scan.lock"), String(process.ppid));
    expect(acquireScanLock(dataDir)).toBe(false);
    expect(readFileSync(join(dataDir, "scan.lock"), "utf8")).toBe(String(process.ppid));
  });

  it("takes over an empty or unreadable lock file once it's a few seconds old (a fresh one is being written)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-lock-"));
    writeFileSync(join(dataDir, "scan.lock"), "");
    expect(acquireScanLock(dataDir)).toBe(false);
    const old = new Date(Date.now() - 10_000);
    utimesSync(join(dataDir, "scan.lock"), old, old);
    expect(acquireScanLock(dataDir)).toBe(true);
    expect(readFileSync(join(dataDir, "scan.lock"), "utf8")).toBe(String(process.pid));
    releaseScanLock(dataDir);
  });

  it("takes over a lock nobody touched for a while, even when its process id is in use again", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-lock-"));
    const lock = join(dataDir, "scan.lock");
    // A live process id (the test runner's parent), but the scan that wrote it stopped touching it 20 minutes ago.
    writeFileSync(lock, String(process.ppid));
    const old = new Date(Date.now() - 20 * 60_000);
    utimesSync(lock, old, old);
    expect(scanLockHeld(dataDir)).toBe(false);
    expect(acquireScanLock(dataDir)).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
    releaseScanLock(dataDir);
  });
});

describe("an overdue scheduled scan", () => {
  const at = Date.parse("2026-11-20T10:00:00Z");
  const run = (o: Partial<ScheduledRun> = {}): ScheduledRun => ({ startedAt: new Date(at).toISOString(), scope: "mine", ok: false, pid: 4242, ...o });
  const h = 3_600_000;

  it("is a scheduled run holding the lock more than an hour past its scheduler's limit", () => {
    // mine: a 4 h backstop, so overdue after 5 h.
    expect(overdueScheduledRun([run()], 4242, at + 5 * h - 1)).toBeUndefined();
    expect(overdueScheduledRun([run()], 4242, at + 5 * h + 1)?.pid).toBe(4242);
    expect(overdueScheduledRun([run({ scope: "all" })], 4242, at + 5 * h + 1)).toBeUndefined();
  });

  it("never one that finished, one whose process doesn't hold the lock, or when nobody does", () => {
    const late = at + 48 * h;
    expect(overdueScheduledRun([run({ finishedAt: new Date(at + h).toISOString() })], 4242, late)).toBeUndefined();
    expect(overdueScheduledRun([run()], 999, late)).toBeUndefined();
    expect(overdueScheduledRun([run()], undefined, late)).toBeUndefined();
  });
});

describe("the scheduled run log", () => {
  it("says a run is going while its process lives, and that it stopped when the process went without logging an end", () => {
    const base: ScheduledRun = { startedAt: "2026-11-22T06:00:00Z", scope: "mine", ok: false, pid: 4242 };
    const done: ScheduledRun = { ...base, startedAt: "2026-11-21T06:00:00Z", ok: true, finishedAt: "2026-11-21T06:20:00Z", pid: undefined };
    expect(scheduledRunsNow([base, done], () => true)).toEqual([{ ...base, running: true }, done]);
    expect(scheduledRunsNow([base], () => false)[0]).toMatchObject({ ok: false, error: UNFINISHED_RUN });
    expect(scheduledRunsNow([{ ...base, error: "fetch failed" }], () => false)[0]!.error).toBe("fetch failed");
  });

  it("replaces the started entry with how it ended", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    recordScheduledRun(dataDir, { startedAt: "2026-11-22T06:00:00Z", scope: "mine", ok: false, pid: process.pid });
    recordScheduledRun(dataDir, { startedAt: "2026-11-22T06:00:00Z", scope: "mine", ok: true, matches: 3, finishedAt: "2026-11-22T06:10:00Z" });
    expect(readScheduledRuns(dataDir)).toEqual([{ startedAt: "2026-11-22T06:00:00Z", scope: "mine", ok: true, matches: 3, finishedAt: "2026-11-22T06:10:00Z" }]);
  });
});
