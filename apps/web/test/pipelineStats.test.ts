import { describe, expect, it } from "vitest";
import { pct, pipelineStats, weekStart } from "../src/lib/pipelineStats";
import type { Activity, Entry } from "../src/lib/userState";

/** Local time on a day in October 2026, as ISO. */
const oct = (day: number, hour = 10) => new Date(2026, 9, day, hour).toISOString();
const sep = (day: number) => new Date(2026, 8, day, 10).toISOString();

const e = (history: Entry["history"], extra: Partial<Entry> = {}): Entry => ({
  status: history?.at(-1)?.status ?? undefined,
  updatedAt: history?.at(-1)?.at ?? oct(1),
  history,
  snapshot: { title: "PM", company: "Acme", url: "", location: "", score: 80 },
  ...extra,
});
const touch = (at: string, channel: Activity["channel"], dir: Activity["dir"], followUp = false): Activity => ({
  id: `${at}${channel}`,
  at,
  channel,
  ...(dir ? { dir } : {}),
  ...(followUp ? { followUp: true as const } : {}),
});

const state = {
  a: e(
    [
      { status: "applied", at: oct(20) },
      { status: "interviewing", at: oct(21) },
    ],
    {
      interviews: [
        { on: "2026-10-23", what: "Panel", time: "14:00" },
        { on: "2026-10-19", what: "Screen" },
      ],
      activities: [
        touch(oct(10), "email", "sent", true), // last week: not counted
        touch(oct(20), "email", "sent", true),
        touch(oct(21), "linkedin", "sent"),
        touch(oct(21), "referral", "sent"),
        touch(oct(21), "note", undefined),
        touch(oct(21), "meeting", "sent"),
        touch(oct(21), "email", "received"),
      ],
    },
  ),
  b: e([{ status: "applied", at: oct(19, 9) }]),
  c: e(
    [
      { status: "applied", at: oct(12) },
      { status: "rejected", at: oct(18) },
    ],
    { closedAs: "no-response" },
  ),
  d: e([
    { status: "applied", at: oct(13) },
    { status: "offer", at: oct(16) },
  ]),
  e: e([{ status: "applied", at: oct(5) }], { activities: [touch(oct(7), "email", "received")] }),
  f: e([{ status: "applied", at: sep(1) }]),
  r: e(
    [
      { status: "applied", at: sep(2) },
      { status: "rejected", at: oct(21) },
    ],
    { closedAs: "rejected", interviews: [{ on: "2026-10-24", what: "Final" }] },
  ),
  s: e([{ status: "saved", at: oct(21) }]),
};

describe("pipeline dashboard stats", () => {
  const thursday = new Date(2026, 9, 22, 12);
  const s = pipelineStats(state, { applications: 2 }, thursday);

  it("starts the week on Monday and ends it on Sunday", () => {
    expect(weekStart(new Date(2026, 9, 22, 15)).getDay()).toBe(1);
    expect(s.week.start.getDate()).toBe(19);
    expect(s.week.end.getDate()).toBe(25);
  });

  it("counts this week's applications, follow-ups and outreach apart", () => {
    expect(s.applied).toBe(2);
    // Only touches from a follow-up task are follow-ups; notes and meetings are neither.
    expect(s.followUps).toBe(1);
    expect(s.outreach).toBe(2);
  });

  it("counts interviews this week and the next one on an open job", () => {
    expect(s.interviewsThisWeek).toBe(3);
    expect(s.upcoming).toBe(1);
    expect(s.next).toEqual({ on: "2026-10-23", time: "14:00" });
  });

  it("buckets the last 8 weeks, oldest first", () => {
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks.map((w) => w.applied).slice(-4)).toEqual([0, 1, 2, 2]);
    expect(s.weeks.at(-1)?.start.getDate()).toBe(19);
  });

  it("counts weeks in a row the applications plan was met", () => {
    expect(s.streak).toBe(2);
    expect(pipelineStats(state, { applications: 1 }, thursday).streak).toBe(3);
    expect(pipelineStats(state, { applications: 3 }, thursday).streak).toBe(0);
    expect(pipelineStats(state, {}, thursday).streak).toBe(0);
  });

  it("doesn't break the run on a week that isn't over", () => {
    const { a, b, ...before } = state;
    expect(pipelineStats(before, { applications: 1 }, thursday).streak).toBe(2);
  });

  it("follows the last 30 days of applications through", () => {
    expect(s.funnel).toEqual({ applied: 5, heardBack: 3, interviewed: 2, offer: 1, noResponse: 1 });
    expect(s.everApplied).toBe(7);
  });

  it("shows the funnel only from 5 applications", () => {
    const few = pipelineStats({ b: state.b, c: state.c }, {}, thursday);
    expect(few.funnel.applied).toBe(2);
  });

  it("formats a share", () => {
    expect(pct(1, 4)).toBe("25%");
    expect(pct(0, 0)).toBe("–");
  });
});
