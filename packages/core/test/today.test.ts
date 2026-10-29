import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { displayName } from "../src/display-name";
import { dailySummaryStatus, installDailySummary, installSchedule, readDailySettings, removeDailySummary, validateDailySummary } from "../src/schedule";
import { cutTitle, readDailySent, sendDailySummary, sendDailyTest, todayMessage, todaySummary, todayTestMessage } from "../src/today";

const secrets = { token: "123:abc", chatId: "42" };
/** 09:00 local on 20 Oct 2026, a Tuesday. */
const NOW = new Date(2026, 9, 20, 9, 0);
const recent = new Date(2026, 9, 15, 9, 0).toISOString();

/** A tracked job: applied five days ago, with the given title and company. */
const job = (title: string, company: string, o: Record<string, unknown> = {}) => ({
  status: "applied",
  updatedAt: recent,
  history: [{ status: o.status ?? "applied", at: recent }],
  snapshot: { title, company, url: "https://example.com", location: "Dubai", score: 80 },
  ...o,
});

/** One of each kind, with people, notes and touches that must never reach the message. */
const busy = {
  i1: job("Head of <Product> & Growth", "Acme", {
    status: "interviewing",
    interviews: [{ on: "2026-10-20", what: "Final", time: "14:00", contactId: "p1" }],
    contacts: [{ id: "p1", name: "Priya Secret", email: "priya@secret.example", phone: "+971500000000" }],
    note: "My private note",
    activities: [{ id: "a1", at: recent, channel: "email", dir: "sent", contactId: "p1", text: "Private message text" }],
  }),
  o1: job("Product Lead", "Beta", { status: "offer", offer: { deadline: "2026-10-21", note: "Offer note" } }),
  t1: job("Senior PM", "Gamma", { status: "interviewing", interviews: [{ on: "2026-10-18", what: "Technical" }] }),
  f1: job("Group PM", "Delta", { followUp: "2026-10-17" }),
  f2: job("Staff PM", "trmlabs", { followUp: "2026-10-20" }),
  s1: job("Saved job", "Epsilon", { status: "saved", followUp: "2026-10-19" }),
  c1: job("Old job", "Zeta", { updatedAt: new Date(2026, 8, 20).toISOString(), history: [{ status: "applied", at: new Date(2026, 8, 20).toISOString() }] }),
  done: job("Done job", "Eta", { followUp: "2026-10-20", skipped: ["follow-up:2026-10-20"] }),
  later: job("Snoozed job", "Theta", { followUp: "2026-10-22" }),
  junk: { status: "applied", interviews: "not a list", followUp: "2026-10-20" },
  closed: job("Closed job", "Iota", { status: "rejected", followUp: "2026-10-01" }),
};

const BUSY_MESSAGE = [
  "☀️ <b>Today in your Pipeline</b>",
  "",
  "📅 Interview: Head of &lt;Product&gt; &amp; Growth · Acme (14:00)",
  "⏳ Answer the offer: Product Lead · Beta (by tomorrow)",
  "✉️ Thank-you: Senior PM · Gamma",
  "⏰ Follow up: Group PM · Delta (3 days overdue)",
  "⏰ Follow up: Staff PM · TRM Labs",
  "",
  "<b>1</b> job to apply to · <b>1</b> job ready to close",
  "",
  "👉 <i>Open the Pipeline in RawJobs on your computer.</i>",
].join("\n");

/** A RawJobs folder whose tracking has these entries, and a fetch that records what was sent. */
function setup(state: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "rj-today-"));
  mkdirSync(join(home, "profile"));
  const write = (s: Record<string, unknown>) => writeFileSync(join(home, "profile", "tracking.json"), JSON.stringify({ app: "rawjobs", version: 1, updatedAt: "", state: s }));
  write(state);
  const sent: string[] = [];
  let fail = false;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    if (fail) return new Response(JSON.stringify({ ok: false, description: "Bad Gateway" }), { status: 502 });
    sent.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
  return { home, dataDir: join(home, "data"), sent, fetchImpl, write, failNext: (on: boolean) => (fail = on) };
}

const TZ = process.env.TZ;
afterEach(() => {
  // Assigning undefined would set the text "undefined" (read as UTC).
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

describe("today's summary", () => {
  it("counts each kind, most urgent first, with the same tasks as Next steps", () => {
    const s = todaySummary(busy, NOW);
    expect(s.lines.map((l) => l.kind)).toEqual(["interview", "offer", "thank-you", "overdue", "follow-up"]);
    expect(s.apply).toBe(1);
    expect(s.close).toBe(1);
    expect(s.lines.find((l) => l.kind === "overdue")?.days).toBe(3);
  });

  it("writes the message: escaped titles, display names, and never people, contact details or notes", () => {
    const text = todayMessage(todaySummary(busy, NOW))!;
    expect(text).toBe(BUSY_MESSAGE);
    for (const secret of ["Priya", "priya@secret.example", "+971500000000", "private note", "Private message", "Offer note", "Snoozed", "Done job", "Closed job"]) expect(text).not.toContain(secret);
  });

  it("shows an interview's time only when you entered one, and an offer due today", () => {
    const s = todaySummary(
      {
        a: job("PM", "Acme", { status: "interviewing", interviews: [{ on: "2026-10-20", what: "Screen" }] }),
        b: job("Lead", "Beta", { status: "offer", offer: { deadline: "2026-10-20" } }),
        c: job("Later offer", "Gamma", { status: "offer", offer: { deadline: "2026-10-23" } }),
      },
      NOW,
    );
    expect(todayMessage(s)).toContain("📅 Interview: PM · Acme\n⏳ Answer the offer: Lead · Beta (by today)\n\n👉");
  });

  it("asks for a reply when they wrote last, without naming them", () => {
    const wrote = { id: "r1", at: new Date(2026, 9, 19, 9, 0).toISOString(), channel: "whatsapp", dir: "received", contactId: "p1", text: "Private reply" };
    const s = todaySummary({ r: job("Product Manager", "Next ventures", { status: "interviewing", activities: [wrote] }) }, NOW);
    expect(s.lines).toEqual([{ kind: "reply", title: "Product Manager", company: "Next ventures" }]);
    expect(todayMessage(s)).toContain("💬 Reply: Product Manager · Next ventures");
    expect(todayMessage(s)).not.toContain("Private");
  });

  it("leaves out an interview time that isn't HH:MM", () => {
    for (const time of ["2pm", "14:00<b>", "1400"]) {
      const s = todaySummary({ a: job("PM", "Acme", { status: "interviewing", interviews: [{ on: "2026-10-20", what: "Final", time }] }) }, NOW);
      expect(todayMessage(s)).toContain("📅 Interview: PM · Acme\n\n👉");
    }
  });

  it("names the company the way the Pipeline card does", () => {
    // The card shows displayName(snapshot.company); the message uses the same.
    for (const company of ["Careem", "trmlabs", "Getrecharge.Com", "Acme Inc."]) {
      const s = todaySummary({ a: job("PM", company, { followUp: "2026-10-20" }) }, NOW);
      expect(s.lines[0]!.company).toBe(displayName(company));
      expect(todayMessage(s)).toContain(`⏰ Follow up: PM · ${displayName(company)}`);
    }
  });

  it("names five, then counts the rest: more follow-ups, and more of any other kind", () => {
    const state: Record<string, unknown> = {};
    for (let i = 1; i <= 4; i++) state[`i${i}`] = job(`Interview ${i}`, "Acme", { status: "interviewing", interviews: [{ on: "2026-10-20", what: "Final", time: `1${i}:00` }] });
    for (let i = 1; i <= 2; i++) state[`t${i}`] = job(`Thanks ${i}`, "Beta", { status: "interviewing", interviews: [{ on: "2026-10-19", what: "Final" }] });
    for (let i = 1; i <= 3; i++) state[`f${i}`] = job(`Follow ${i}`, "Gamma", { followUp: `2026-10-1${i}` });
    const text = todayMessage(todaySummary(state, NOW))!;
    const lines = text.split("\n\n")[1]!.split("\n");
    expect(lines).toHaveLength(5);
    // Earliest interview first.
    expect(lines[0]).toContain("Interview 1 · Acme (11:00)");
    expect(lines[4]).toContain("Thanks");
    expect(text).toContain("<b>+3</b> more follow-ups · <b>+1</b> more task");
  });

  it("cuts long titles at 60 characters", () => {
    const long = "Senior Principal Product Manager, Payments Platform and Risk Infrastructure";
    expect(cutTitle(long)).toHaveLength(60);
    expect(cutTitle(long).endsWith("…")).toBe(true);
    expect(cutTitle("Short title")).toBe("Short title");
    expect(todayMessage(todaySummary({ a: job(long, "Acme", { followUp: "2026-10-20" }) }, NOW))).toContain(`⏰ Follow up: ${cutTitle(long)} · Acme`);
  });

  it("sends nothing when nothing is due", () => {
    expect(todayMessage(todaySummary({ a: job("PM", "Acme", { followUp: "2026-10-25" }) }, NOW))).toBeUndefined();
    expect(todayMessage(todaySummary(undefined, NOW))).toBeUndefined();
  });

  it("counts only Saved and close jobs when that's all there is", () => {
    expect(todayMessage(todaySummary({ s: busy.s1, c: busy.c1 }, NOW))).toBe(
      "☀️ <b>Today in your Pipeline</b>\n\n<b>1</b> job to apply to · <b>1</b> job ready to close\n\n👉 <i>Open the Pipeline in RawJobs on your computer.</i>",
    );
  });

  it("reads the day in local time, across a clock change", () => {
    // Europe/London leaves summer time on 25 Oct 2026: yesterday is still one day overdue.
    process.env.TZ = "Europe/London";
    const s = todaySummary({ a: job("PM", "Acme", { followUp: "2026-10-24" }), b: job("Lead", "Beta", { followUp: "2026-10-25" }) }, new Date(2026, 9, 25, 9, 0));
    expect(s.lines.map((l) => [l.kind, l.days])).toEqual([
      ["overdue", 1],
      ["follow-up", undefined],
    ]);
    // 21:30 UTC on 20 Oct is already 21 Oct in Dubai.
    process.env.TZ = "Asia/Dubai";
    const dubai = todaySummary(
      { a: job("PM", "Acme", { followUp: "2026-10-21" }), b: job("Lead", "Beta", { status: "interviewing", interviews: [{ on: "2026-10-20", what: "Final" }] }) },
      new Date("2026-10-20T21:30:00Z"),
    );
    expect(dubai.lines.map((l) => l.kind)).toEqual(["thank-you", "follow-up"]);
  });
});

describe("sending it", () => {
  it("sends once a day, and again the next day", async () => {
    const s = setup(busy);
    const opts = { home: s.home, now: NOW, fetchImpl: s.fetchImpl };
    expect(await sendDailySummary(s.dataDir, secrets, opts)).toBe("sent");
    expect(s.sent).toEqual([BUSY_MESSAGE]);
    expect(readDailySent(s.dataDir)).toEqual({ day: "2026-10-20", at: NOW.toISOString(), result: "sent" });
    expect(await sendDailySummary(s.dataDir, secrets, { ...opts, now: new Date(2026, 9, 20, 10, 0) })).toBe("already-sent");
    expect(await sendDailySummary(s.dataDir, secrets, { ...opts, now: new Date(2026, 9, 21, 9, 0) })).toBe("sent");
    expect(s.sent).toHaveLength(2);
  });

  it("notes a day with nothing due, and still sends later that day once something is", async () => {
    const s = setup({});
    const opts = { home: s.home, now: NOW, fetchImpl: s.fetchImpl };
    expect(await sendDailySummary(s.dataDir, secrets, opts)).toBe("nothing-due");
    expect(readDailySent(s.dataDir)?.result).toBe("nothing-due");
    expect(s.sent).toEqual([]);
    s.write(busy);
    expect(await sendDailySummary(s.dataDir, secrets, opts)).toBe("sent");
  });

  it("skips a scheduled run after 12:00, but not one you start yourself", async () => {
    const s = setup(busy);
    const late = { home: s.home, now: new Date(2026, 9, 20, 12, 1), fetchImpl: s.fetchImpl };
    expect(await sendDailySummary(s.dataDir, secrets, { ...late, scheduled: true })).toBe("too-late");
    expect(s.sent).toEqual([]);
    expect(await sendDailySummary(s.dataDir, secrets, { ...late, now: new Date(2026, 9, 20, 12, 0), scheduled: true })).toBe("sent");
    const s2 = setup(busy);
    expect(await sendDailySummary(s2.dataDir, secrets, { ...late, home: s2.home, fetchImpl: s2.fetchImpl })).toBe("sent");
  });

  it("does nothing without Telegram, and tries again after a failed send", async () => {
    const s = setup(busy);
    const opts = { home: s.home, now: NOW, fetchImpl: s.fetchImpl };
    expect(await sendDailySummary(s.dataDir, {}, opts)).toBe("off");
    s.failNext(true);
    expect(await sendDailySummary(s.dataDir, secrets, opts)).toMatch(/^failed: /);
    expect(readDailySent(s.dataDir)).toBeUndefined();
    s.failNext(false);
    expect(await sendDailySummary(s.dataDir, secrets, opts)).toBe("sent");
  });

  it("sends a test with today's real items, or says when it will come", async () => {
    expect(todayTestMessage(todaySummary({}, NOW), "09:00")).toBe(
      "☀️ <b>Today in your Pipeline</b>\n\nThis is a test. Your daily summary will arrive at 09:00 when something is due.\n\n👉 <i>Change it in RawJobs → Settings → Notifications.</i>",
    );
    expect(todayTestMessage(todaySummary(busy, NOW), "09:00")).toBe(BUSY_MESSAGE.replace("\n\n📅", "\n\nThis is a test.\n\n📅"));
    // Any time, and as often as you like: it never counts as today's message.
    const s = setup(busy);
    const opts = { home: s.home, now: new Date(2026, 9, 20, 18, 0), fetchImpl: s.fetchImpl };
    expect(await sendDailyTest(secrets, "09:00", opts)).toBe("sent");
    expect(await sendDailyTest(secrets, "09:00", opts)).toBe("sent");
    expect(readDailySent(s.dataDir)).toBeUndefined();
    expect(await sendDailyTest({}, "09:00", opts)).toBe("off");
  });
});

describe("the daily summary's scheduled task", () => {
  const record = () => {
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    };
    return { calls, exec };
  };

  it("takes a morning time only", () => {
    expect(validateDailySummary({})).toEqual({ time: "09:00" });
    expect(validateDailySummary({ time: "11:30" })).toEqual({ time: "11:30" });
    expect(() => validateDailySummary({ time: "12:00" })).toThrow(/before 12:00/);
    expect(() => validateDailySummary({ time: "9am" })).toThrow(/isn't a time/);
  });

  it("ignores a broken settings file instead of failing", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "rj-daily-"));
    const file = join(dataDir, "daily-summary.json");
    for (const bad of ["not json", "null", '{"time":9}', '{"time":"9am"}', "[]"]) {
      writeFileSync(file, bad);
      expect(readDailySettings(dataDir)).toBeUndefined();
      expect(() => dailySummaryStatus({ repoRoot: "/repo", dataDir, platform: "darwin", home: dataDir })).not.toThrow();
    }
    writeFileSync(file, '{"time":"08:30"}');
    expect(readDailySettings(dataDir)).toEqual({ time: "08:30" });
  });

  it("Windows: its own task, apart from the scans, running today --notify --scheduled", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "rj-daily-"));
    const { calls, exec } = record();
    installDailySummary({ repoRoot: "/repo", dataDir, exec, platform: "win32" }, { time: "08:30" });
    const script = calls[0]!.at(-1)!;
    expect(calls).toHaveLength(1);
    expect(script).toContain("Register-ScheduledTask -TaskName 'RawJobs daily summary'");
    expect(script).toContain("New-ScheduledTaskTrigger -Daily -At '08:30'");
    expect(script).toContain("-StartWhenAvailable");
    expect(script).toContain("-ExecutionTimeLimit (New-TimeSpan -Hours 1)");
    expect(script).toContain("today --notify --scheduled --data");
    expect(script).toContain("-Description 'RawJobs: send what''s due in your Pipeline today to Telegram.'");
    expect(JSON.parse(readFileSync(join(dataDir, "daily-summary.json"), "utf8"))).toEqual({ time: "08:30" });

    removeDailySummary({ repoRoot: "/repo", dataDir, exec, platform: "win32" });
    expect(calls.at(-1)!.at(-1)).toContain("Unregister-ScheduledTask -TaskName 'RawJobs daily summary'");
    expect(calls.flat().join(" ")).not.toContain("RawJobs Scan");
    expect(existsSync(join(dataDir, "daily-summary.json"))).toBe(false);
  });

  it("macOS: a launch agent of its own; Linux: a persistent timer of its own", () => {
    const home = mkdtempSync(join(tmpdir(), "rj-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "rj-daily-"));
    const { exec } = record();
    installDailySummary({ repoRoot: "/repo", dataDir, exec, platform: "darwin", home }, { time: "07:30" });
    const plist = readFileSync(join(home, "Library/LaunchAgents/com.rawjobs.daily-summary.plist"), "utf8");
    expect(plist).toContain("<key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer>");
    expect(plist).toContain("<string>today</string>\n    <string>--notify</string>\n    <string>--scheduled</string>");
    expect(plist).toContain("daily-summary.log");
    expect(dailySummaryStatus({ repoRoot: "/repo", dataDir, exec, platform: "darwin", home })).toMatchObject({ installed: true, settings: { time: "07:30" } });

    installDailySummary({ repoRoot: "/repo", dataDir, exec, platform: "linux", home }, { time: "09:00" });
    const timer = readFileSync(join(home, ".config/systemd/user/rawjobs-daily-summary.timer"), "utf8");
    expect(timer).toContain("Description=RawJobs daily summary");
    expect(timer).toContain("OnCalendar=*-*-* 09:00:00\nPersistent=true");
    expect(readFileSync(join(home, ".config/systemd/user/rawjobs-daily-summary.service"), "utf8")).toContain("today --notify --scheduled --data");
  });

  it("is installed and removed apart from scheduled scans", () => {
    const home = mkdtempSync(join(tmpdir(), "rj-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "rj-daily-"));
    const { exec } = record();
    const ctx = { repoRoot: "/repo", dataDir, exec, platform: "darwin" as const, home };
    installSchedule(ctx, { times: ["08:00"], scope: "mine" });
    installDailySummary(ctx, { time: "09:00" });
    removeDailySummary(ctx);
    expect(existsSync(join(home, "Library/LaunchAgents/com.rawjobs.scan.plist"))).toBe(true);
    expect(existsSync(join(home, "Library/LaunchAgents/com.rawjobs.daily-summary.plist"))).toBe(false);
    expect(dailySummaryStatus(ctx).installed).toBe(false);
  });
});
