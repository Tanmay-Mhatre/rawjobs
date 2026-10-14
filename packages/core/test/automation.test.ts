import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digest, findTelegramChat, finishedMessage, looksLikeToken, maskToken, saveTelegramSecrets, sendTelegram, telegramSecrets } from "../src/notify";
import { acquireScanLock, releaseScanLock } from "../src/scan";
import { installSchedule, nextRunAt, readScheduledRuns, recordScheduledRun, removeSchedule, runScheduleNow, scheduleStatus, validateSchedule } from "../src/schedule";
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

describe("finishedMessage", () => {
  it("says the scan finished, with the same counts as the digest", () => {
    expect(finishedMessage({ newJobs: [job("A", 80), job("B", 50)], minScore: 70, scope: "mine" })).toBe(
      "✅ <b>Your scan finished</b>\n\n<b>2</b> new jobs · <b>1</b> strong fit\n\n👉 <i>Open RawJobs on your computer to see them.</i>",
    );
    expect(finishedMessage({ newJobs: [], minScore: 70, scope: "all" })).toBe("✅ <b>Every company scan finished</b>\n\nNo new jobs\n\n👉 <i>Open RawJobs on your computer to see your matches.</i>");
  });

  it("says a scan stopped, and to finish it", () => {
    expect(finishedMessage({ newJobs: [job("A", 50)], minScore: 70, stopped: true, scope: "mine" })).toBe(
      "⏸ <b>Your scan stopped</b>\n\n<b>1</b> new job · no strong fits\n\n👉 <i>Open RawJobs on your computer to see it and finish the scan.</i>",
    );
    expect(finishedMessage({ newJobs: [], minScore: 70, stopped: true, scope: "mine" })).toBe(
      "⏸ <b>Your scan stopped</b>\n\nNo new jobs yet\n\n👉 <i>Open RawJobs on your computer to finish the scan.</i>",
    );
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
    // The task from before the rename goes, so nothing scans twice.
    expect(scripts[1]).toContain("Unregister-ScheduledTask -TaskName 'JobHunter Scan'");
    expect(script).toContain("-StartWhenAvailable -WakeToRun");
    expect(script).toContain("-ExecutionTimeLimit (New-TimeSpan -Hours 4)");
    expect(script).toContain("New-ScheduledTaskTrigger -Daily -At '08:00'");
    expect(script).toContain("New-ScheduledTaskTrigger -Daily -At '20:00'");
    expect(script).toContain("-Execute 'conhost.exe' -Argument '--headless ");
    expect(script).toContain("scan --scope all --notify --scheduled --data");
    // A quote in a path is doubled for PowerShell.
    expect(script).toContain(`-WorkingDirectory '${repo.replace(/'/g, "''")}'`);
    expect(JSON.parse(readFileSync(join(dataDir, "schedule.json"), "utf8"))).toEqual({ times: ["08:00", "20:00"], scope: "all" });

    // An installed copy keeps your config elsewhere: the scan runs there, the code stays where it is.
    const mine = join(tmpdir(), "My RawJobs");
    installSchedule({ repoRoot: repo, workDir: mine, dataDir, exec, platform: "win32" }, { times: ["08:00"], scope: "mine" });
    expect(scripts.at(-2)).toContain(`-WorkingDirectory '${mine}'`);
    expect(scripts.at(-2)).toContain(join(repo, "packages/cli/src/index.ts").replace(/'/g, "''"));

    removeSchedule({ repoRoot: repo, dataDir, exec, platform: "win32" });
    expect(scripts.slice(-2)).toEqual([expect.stringContaining("-TaskName 'RawJobs Scan'"), expect.stringContaining("-TaskName 'JobHunter Scan'")]);
    expect(existsSync(join(dataDir, "schedule.json"))).toBe(false);
  });

  it("macOS: writes a launch agent with each time; Linux: a persistent systemd timer", () => {
    const home = mkdtempSync(join(tmpdir(), "jh-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    const exec = () => ({ status: 0, stdout: "", stderr: "" });
    installSchedule({ repoRoot: "/repo", dataDir, exec, platform: "darwin", home }, { times: ["07:30"], scope: "mine" });
    const plist = readFileSync(join(home, "Library/LaunchAgents/com.rawjobs.scan.plist"), "utf8");
    expect(plist).toContain("<key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer>");
    expect(plist).toContain("<string>--notify</string>");
    expect(scheduleStatus({ repoRoot: "/repo", dataDir, exec, platform: "darwin", home }).installed).toBe(true);

    installSchedule({ repoRoot: "/repo", dataDir, exec, platform: "linux", home }, { times: ["07:30", "19:00"], scope: "mine" });
    const timer = readFileSync(join(home, ".config/systemd/user/rawjobs-scan.timer"), "utf8");
    expect(timer).toContain("OnCalendar=*-*-* 07:30:00\nOnCalendar=*-*-* 19:00:00\nPersistent=true");
  });

  it("keeps a schedule saved before the rename working until it's saved again, then replaces it", () => {
    const home = mkdtempSync(join(tmpdir(), "jh-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    };
    const ctx = { repoRoot: "/repo", dataDir, exec, platform: "darwin" as const, home };
    const legacy = join(home, "Library/LaunchAgents/com.jobhunter.scan.plist");
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(legacy, "<plist/>");
    writeFileSync(join(dataDir, "schedule.json"), JSON.stringify({ times: ["07:30"], scope: "mine" }));

    expect(scheduleStatus(ctx).installed).toBe(true);
    runScheduleNow(ctx);
    expect(calls.at(-1)).toEqual(["launchctl", "start", "com.jobhunter.scan"]);

    installSchedule(ctx, { times: ["07:30"], scope: "mine" });
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(home, "Library/LaunchAgents/com.rawjobs.scan.plist"))).toBe(true);
    runScheduleNow(ctx);
    expect(calls.at(-1)).toEqual(["launchctl", "start", "com.rawjobs.scan"]);
  });

  it("logs scheduled runs, newest first", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-sched-"));
    recordScheduledRun(dataDir, { startedAt: "2026-10-08T04:00:00Z", scope: "mine", ok: true, matches: 3 });
    recordScheduledRun(dataDir, { startedAt: "2026-10-09T04:00:00Z", scope: "mine", ok: false, error: "offline" });
    expect(readScheduledRuns(dataDir).map((r) => r.startedAt)).toEqual(["2026-10-09T04:00:00Z", "2026-10-08T04:00:00Z"]);
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

  it("takes over an empty or unreadable lock file", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "jh-lock-"));
    writeFileSync(join(dataDir, "scan.lock"), "");
    expect(acquireScanLock(dataDir)).toBe(true);
    expect(readFileSync(join(dataDir, "scan.lock"), "utf8")).toBe(String(process.pid));
  });
});
