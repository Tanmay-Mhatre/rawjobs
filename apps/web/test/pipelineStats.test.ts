import { describe, expect, it } from "vitest";
import { pct, pipelineStats, weekStart } from "../src/lib/pipelineStats";
import type { Entry } from "../src/lib/userState";

const e = (score: number, history: Entry["history"], extra: Partial<Entry> = {}): Entry => ({
  status: history?.at(-1)?.status ?? undefined,
  updatedAt: history?.at(-1)?.at ?? "2026-10-01T00:00:00Z",
  history,
  snapshot: { title: "PM", company: "Acme", url: "", location: "", score },
  ...extra,
});

describe("pipeline insights", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const state = {
    a: e(85, [
      { status: "applied", at: "2026-10-01T00:00:00Z" },
      { status: "interviewing", at: "2026-10-05T00:00:00Z" },
    ]),
    b: e(70, [{ status: "applied", at: "2026-10-20T09:00:00Z" }]),
    c: e(
      60,
      [
        { status: "applied", at: "2026-09-01T00:00:00Z" },
        { status: "rejected", at: "2026-09-29T00:00:00Z" },
      ],
      { closedAs: "no-response" },
    ),
    d: e(
      90,
      [
        { status: "applied", at: "2026-10-10T00:00:00Z" },
        { status: "rejected", at: "2026-10-12T00:00:00Z" },
      ],
      { closedAs: "rejected" },
    ),
    s: e(95, [{ status: "saved", at: "2026-10-21T00:00:00Z" }]),
    "manual:x": e(0, [{ status: "interviewing", at: "2026-10-18T00:00:00Z" }]),
  };
  const s = pipelineStats(state, now);

  it("counts applications, replies and ghosting", () => {
    expect(s.applied).toBe(5);
    expect(s.replied).toBe(3);
    expect(s.ghosted).toBe(1);
    expect(s.applied30).toBe(4);
    expect(s.appliedThisWeek).toBe(1);
  });

  it("takes the median wait for a reply", () => {
    // a: 4 days, d: 2 days, manual: 0 days → 2
    expect(s.medianDaysToReply).toBe(2);
  });

  it("splits reply rate by fit score, leaving out jobs added by hand", () => {
    expect(s.bands).toEqual([
      { label: "Score 80+", applied: 2, replied: 2 },
      { label: "Score 65–79", applied: 1, replied: 0 },
      { label: "Below 65", applied: 1, replied: 0 },
    ]);
    expect(pct(1, 4)).toBe("25%");
    expect(pct(0, 0)).toBe("–");
  });

  it("starts the week on Monday", () => {
    expect(weekStart(new Date(2026, 9, 22, 15)).getDay()).toBe(1);
  });
});
