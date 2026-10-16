import { describe, expect, it } from "vitest";
import { LEARN, learnedNudge, learnOrder } from "../src/learn";
import type { ScoreBreakdown } from "../src/schema";

const why = (level: number, keywordPoints: number): ScoreBreakdown => ({
  title: 20 + level,
  level,
  focus: 1,
  location: 20,
  keywords: [],
  keywordPoints,
  industry: 5,
  checks: [{ id: "place", status: "met", note: "" }],
});

describe("learnOrder", () => {
  it("waits for enough choices of each kind", () => {
    expect(
      learnOrder([
        { why: why(10, 20), liked: true },
        { why: why(0, 20), liked: false },
      ]),
    ).toBeUndefined();
  });

  it("learns that your level matters to you, and nudges by at most maxNudge", () => {
    const picks = [10, 10, 10, 10].map((l, i) => ({ why: why(l, 10 + i * 5), liked: true })).concat([0, 0, 0, 0].map((l, i) => ({ why: why(l, 10 + i * 5), liked: false })));
    const m = learnOrder(picks)!;
    expect(m).toMatchObject({ liked: 4, disliked: 4 });
    const up = learnedNudge(m, why(10, 20));
    const down = learnedNudge(m, why(0, 20));
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
    expect(Math.abs(up)).toBeLessThanOrEqual(LEARN.maxNudge);
  });

  it("leaves older scores and gated jobs alone", () => {
    const m = learnOrder(
      [...Array(3)].flatMap(() => [
        { why: why(10, 20), liked: true },
        { why: why(0, 20), liked: false },
      ]),
    )!;
    expect(learnedNudge(m, { title: 30, location: 20, keywords: [], keywordPoints: 0 })).toBe(0);
    expect(learnedNudge(m, { ...why(10, 20), gate: "title" })).toBe(0);
    expect(learnedNudge(undefined, why(10, 20))).toBe(0);
  });
});
