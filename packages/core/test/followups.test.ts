import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applicationsPlan, dueDeadlines, dueFollowUps, dueInterviews, followUpMessage, interviewMessage, lastWeek, remindFollowUps, weeklyMessage } from "../src/followups";

const secrets = { token: "123:abc", chatId: "42" };

/** A RawJobs folder whose tracking has these entries, and a fetch that records what was sent. */
function setup(state: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "rj-follow-"));
  mkdirSync(join(home, "profile"));
  mkdirSync(join(home, "data"));
  writeFileSync(join(home, "profile", "tracking.json"), JSON.stringify({ app: "rawjobs", version: 1, updatedAt: "", state }));
  const sent: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
  return { home, dataDir: join(home, "data"), sent, fetchImpl };
}

describe("follow-up reminders", () => {
  it("finds jobs in an active stage whose date has come", () => {
    const state = {
      a: { status: "applied", followUp: "2026-10-23" },
      b: { status: "applied", followUp: "2026-10-30" },
      c: { status: "interviewing", followUp: "2026-10-01" },
      d: { status: "applied", followUp: "next week" },
      e: { status: "rejected", followUp: "2026-10-01" },
      f: { status: "saved", followUp: "2026-10-22" },
    };
    expect(dueFollowUps(state, "2026-10-23")).toEqual([
      { id: "a", followUp: "2026-10-23" },
      { id: "c", followUp: "2026-10-01" },
      { id: "f", followUp: "2026-10-22" },
    ]);
    expect(dueFollowUps(undefined, "2026-10-23")).toEqual([]);
  });

  it("says how many, never which", () => {
    expect(followUpMessage(2)).toContain("<b>2</b> jobs are due a follow-up.");
    expect(followUpMessage(1)).toContain("<b>1</b> job is due a follow-up.");
  });

  it("sends each follow-up once, and again only when you move its date", async () => {
    const s = setup({ a: { status: "applied", followUp: "2026-10-23" } });
    const now = new Date("2026-10-24T12:00:00");
    expect(await remindFollowUps(s.dataDir, secrets, { home: s.home, now, fetchImpl: s.fetchImpl })).toBe("sent");
    expect(await remindFollowUps(s.dataDir, secrets, { home: s.home, now, fetchImpl: s.fetchImpl })).toBe("nothing-due");
    expect(s.sent).toHaveLength(1);
    writeFileSync(join(s.home, "profile", "tracking.json"), JSON.stringify({ state: { a: { status: "applied", followUp: "2026-10-24" } } }));
    expect(await remindFollowUps(s.dataDir, secrets, { home: s.home, now, fetchImpl: s.fetchImpl })).toBe("sent");
  });
});

describe("interview reminders", () => {
  it("finds interviews today or tomorrow only", () => {
    const state = {
      a: {
        status: "interviewing",
        interviews: [
          { on: "2026-10-20", what: "Technical" },
          { on: "2026-10-28", what: "Final" },
        ],
      },
      b: { status: "interviewing", interviews: [{ on: "2026-10-19", what: "Screen" }] },
      c: { status: "applied", interviews: "nope" },
    };
    expect(dueInterviews(state, "2026-10-19", "2026-10-20")).toEqual(["a 2026-10-20", "b 2026-10-19"]);
  });
});

describe("weekly summary", () => {
  it("counts last week's applications and replies from dated steps", () => {
    const from = Date.parse("2026-10-12T00:00:00Z");
    const to = Date.parse("2026-10-19T00:00:00Z");
    const state = {
      a: {
        history: [
          { status: "applied", at: "2026-10-13T09:00:00Z" },
          { status: "interviewing", at: "2026-10-16T09:00:00Z" },
        ],
      },
      b: { history: [{ status: "applied", at: "2026-10-20T09:00:00Z" }] },
      c: { closedAs: "no-response", history: [{ status: "rejected", at: "2026-10-14T09:00:00Z" }] },
      d: { closedAs: "rejected", history: [{ status: "rejected", at: "2026-10-15T09:00:00Z" }] },
    };
    expect(lastWeek(state, from, to)).toEqual({ applied: 1, followUps: 0, replies: 2 });
  });

  it("counts follow-ups sent and replies from touches, each job's replies once", () => {
    const from = Date.parse("2026-10-12T00:00:00Z");
    const to = Date.parse("2026-10-19T00:00:00Z");
    const state = {
      a: {
        history: [{ status: "interviewing", at: "2026-10-16T09:00:00Z" }],
        activities: [
          { at: "2026-10-13T09:00:00Z", channel: "email", dir: "sent", followUp: true },
          { at: "2026-10-14T09:00:00Z", channel: "email", dir: "received" },
        ],
      },
      b: {
        activities: [
          { at: "2026-10-13T09:00:00Z", channel: "linkedin", dir: "sent" },
          { at: "2026-10-15T09:00:00Z", channel: "whatsapp", dir: "sent", followUp: true },
          { at: "2026-10-20T09:00:00Z", channel: "email", dir: "received" },
          { at: "2026-10-15T09:00:00Z", channel: "note", dir: "received" },
        ],
      },
    };
    expect(lastWeek(state, from, to)).toEqual({ applied: 0, followUps: 2, replies: 1 });
  });

  it("reads the plan before the v1 goal", () => {
    expect(applicationsPlan({ weeklyPlan: { applications: 6 }, weeklyGoal: 4 })).toBe(6);
    expect(applicationsPlan({ weeklyGoal: 4 })).toBe(4);
    expect(applicationsPlan({ weeklyPlan: {} })).toBeUndefined();
    expect(applicationsPlan(undefined)).toBeUndefined();
  });

  it("says counts only: no names, details or notes from your tracking", () => {
    const state = {
      "greenhouse:acme:1": {
        status: "applied",
        note: "Secret salary note",
        snapshot: { title: "Head of Product", company: "Acme Bank", url: "https://acme.example/1", location: "Dubai", score: 90 },
        history: [{ status: "applied", at: "2026-10-13T09:00:00Z" }],
        contacts: [{ id: "p1", name: "Priya Raman", email: "priya@acme.example", phone: "+971501234567", linkedin: "https://www.linkedin.com/in/priya", howMet: "Fintech meetup" }],
        activities: [{ id: "x", at: "2026-10-14T09:00:00Z", channel: "email", dir: "sent", contactId: "p1", text: "Following up on my application", followUp: true }],
      },
    };
    const w = lastWeek(state, Date.parse("2026-10-12T00:00:00Z"), Date.parse("2026-10-19T00:00:00Z"));
    const messages = [weeklyMessage(w, 5), followUpMessage(1), interviewMessage(1)];
    expect(messages[0]).toContain("<b>1</b> application (plan 5), <b>1</b> follow-up, <b>0</b> replies.");
    const values: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") values.push(v);
      else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
    };
    walk(state);
    for (const m of messages) for (const v of values.filter((x) => x.length > 3)) expect(m).not.toContain(v);
  });
});

describe("offer deadlines", () => {
  it("finds offers to answer today or tomorrow, only while at Offer", () => {
    const state = {
      a: { status: "offer", offer: { deadline: "2026-10-20" } },
      b: { status: "rejected", offer: { deadline: "2026-10-20" } },
      c: { status: "offer", offer: { deadline: "2026-10-30" } },
    };
    expect(dueDeadlines(state, "2026-10-19", "2026-10-20")).toEqual(["a 2026-10-20"]);
  });
});
