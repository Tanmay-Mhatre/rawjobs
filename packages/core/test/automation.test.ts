import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digest, findTelegramChat, finishedMessage, looksLikeToken, maskToken, saveTelegramSecrets, sendTelegram, telegramSecrets } from "../src/notify";
import { acquireScanLock, releaseScanLock } from "../src/scan";
import { installSchedule, nextRunAt, readScheduledRuns, recordScheduledRun, removeSchedule, runScheduleNow, scheduleStatus, validateSchedule } from "../src/schedule";
import type { Job } from "../src/schema";

const job = (title: string, score: number, extra: Partial<Job> = {}): Job =>
  ({
    id: `greenhouse:co:${title}`,
    ats: "greenhouse",
    company: "Co <&>",
    title,
    location: "Dubai, UAE; Remote",
    url: `https://example.com/${encodeURIComponent(title)}`,
    firstSeen: "2026-10-01T00:00:00Z",
    lastSeen: "2026-10-01T00:00:00Z",
    status: "open",
    score,
    why: { title: 30, location: 20, keywords: [], keywordPoints: 0, freshness: 10 },
    ...extra,
  }) as Job;

describe("digest", () => {
  it("says nothing when there's nothing new", () => {
    expect(digest([], { minScore: 70 })).toBeUndefined();
  });

  it("lists the best first, labels strong fits, links, escaped text and the first place only", () => {
    const text = digest([job("PM", 60), job("Head of Product", 85)], { minScore: 70, scopeLabel: "My companies + my industries" })!;
    expect(text.startsWith("<b>2 new jobs for you</b> · 1 strong\n<i>My companies + my industries</i>")).toBe(true);
    expect(text.indexOf("Head of Product")).toBeLessThan(text.indexOf(">PM<"));
    expect(text).toContain('\n\n<a href="https://example.com/Head%20of%20Product">Head of Product</a>\nCo &lt;&amp;&gt; · Dubai, UAE · score 85/100 · strong fit');
    expect(text).not.toContain("⭐");
  });

  it("says which dealbreaker a job breaks, in place of strong fit", () => {
    const why = { title: 30, location: 20, keywords: [], keywordPoints: 0, industry: 10, dealbreakers: ["Pay below your floor: up to AED 18k vs your 25k a month"] };
    const text = digest([job("SMB AE", 48, { why })], { minScore: 40 })!;
    expect(text).toContain("score 48/100 · Pay below your floor: up to AED 18k vs your 25k a month");
    expect(text).not.toContain("strong fit");
  });

  it("stars jobs at your companies, as the Radar does", () => {
    const text = digest([job("Yours", 50, { id: "greenhouse:acme:1" }), job("Other", 50, { id: "lever:else:1" })], { minScore: 70, yours: new Set(["greenhouse:acme"]) })!;
    expect(text).toContain('⭐ <a href="https://example.com/Yours">Yours</a>');
    expect(text).toContain('\n\n<a href="https://example.com/Other">Other</a>');
  });

  it("uses the Radar's best-match order: a slightly lower job posted today beats an older one", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const old = job("Old", 80, { postedAt: "2026-09-30T12:00:00Z" });
    const fresh = job("Fresh", 76, { postedAt: "2026-10-10T12:00:00Z" });
    const text = digest([old, fresh], { minScore: 70, now })!;
    expect(text.indexOf(">Fresh<")).toBeLessThan(text.indexOf(">Old<"));
  });

  it("caps at 10 lines and points to the rest", () => {
    const text = digest(
      Array.from({ length: 13 }, (_, i) => job(`Role ${i}`, 50 + i)),
      { minScore: 90 },
    )!;
    expect(text.match(/<a /g)).toHaveLength(10);
    expect(text).toContain("…and 3 more on your Radar.");
  });
});

describe("finishedMessage", () => {
  it("always says the scan is complete, with totals, 'no new jobs' and where to look", () => {
    const none = finishedMessage({ scopeLabel: "All companies", matches: 3, newJobs: [], minScore: 70, total: 16538 });
    expect(none).toBe(
      "✅ <b>Scan complete</b> · All companies\n16,538 companies checked.\n3 jobs match you.\n\nNo new jobs this time.\n\n💻 Open RawJobs on your laptop to see every job: http://127.0.0.1:5173",
    );
  });

  it("splits the new jobs into your companies, strong fits elsewhere and the rest, adding up", () => {
    const newJobs = [job("Yours strong", 90, { id: "Greenhouse:Acme:1" }), job("Yours weak", 40, { id: "greenhouse:acme:2" }), job("Strong", 80), job("Other A", 50), job("Other B", 60)];
    const text = finishedMessage({ scopeLabel: "My companies + my industries", matches: 384, newJobs, minScore: 70, yours: new Set(["greenhouse:acme"]) });
    expect(text).toContain(
      '<b>5 new jobs</b>\n⭐ 2 from your companies (1 strong fit)\n🎯 1 strong fit (score 70+) from other companies\n• 2 other matches\n\n⭐ <a href="https://example.com/Yours%20strong">Yours strong</a>\nCo &lt;&amp;&gt; · Dubai, UAE · score 90/100 · strong fit',
    );
    expect(text.match(/<a /g)).toHaveLength(5);
    expect(text.endsWith("\n\n💻 Open RawJobs on your laptop to see every job: http://127.0.0.1:5173")).toBe(true);
  });

  it("says where a stopped scan got to", () => {
    expect(finishedMessage({ scopeLabel: "All companies", matches: 0, newJobs: [], minScore: 70, stopped: true, done: 900, total: 16538 })).toMatch(
      /^⏸ <b>Scan stopped<\/b> · All companies\nGot to 900 of 16,538 companies\. Start it again/,
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
