import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dueFollowUps, dueInterviews, followUpMessage, lastWeek, remindFollowUps } from "../src/followups";

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
  it("finds jobs you applied to whose date has come", () => {
    const state = {
      a: { status: "applied", followUp: "2026-10-23" },
      b: { status: "applied", followUp: "2026-10-30" },
      c: { status: "interviewing", followUp: "2026-10-01" },
      d: { status: "applied", followUp: "next week" },
    };
    expect(dueFollowUps(state, "2026-10-23")).toEqual([{ id: "a", followUp: "2026-10-23" }]);
    expect(dueFollowUps(undefined, "2026-10-23")).toEqual([]);
  });

  it("says how many, never which", () => {
    expect(followUpMessage(2)).toContain("<b>2</b> jobs you applied to are due a follow-up.");
    expect(followUpMessage(1)).toContain("<b>1</b> job you applied to is due a follow-up.");
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
    expect(lastWeek(state, from, to)).toEqual({ applied: 1, replies: 2 });
  });
});
