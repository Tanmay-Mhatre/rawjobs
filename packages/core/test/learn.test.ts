import { describe, expect, it } from "vitest";
import { choiceWeight, fitFeatures, LEARN, learnedNudge, learnOrder, type Choice } from "../src/learn";
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
const NOW = Date.parse("2026-10-16T00:00:00Z");
const pick = (level: number, kp: number, status: string, score: number, extra: Partial<Choice> = {}): Choice => ({ why: why(level, kp), status, score, at: "2026-10-15T00:00:00Z", ...extra });

// You like jobs at your level and hide ones that aren't, whatever their score says.
const choices = [...[0, 1, 2, 3, 4, 5].map((i) => pick(10, 10 + i * 5, "saved", 60 + i)), ...[0, 1, 2, 3, 4, 5].map((i) => pick(0, 10 + i * 5, "dismissed", 62 + i))];

describe("learnOrder", () => {
  it("waits for enough choices of each kind", () => {
    expect(learnOrder([pick(10, 20, "saved", 70), pick(0, 20, "dismissed", 70)], NOW)).toBeUndefined();
  });

  it("learns that your level matters to you, says so, and nudges by at most maxNudge", () => {
    const m = learnOrder(choices, NOW)!;
    expect(m).toMatchObject({ liked: 6, disliked: 6, helps: true, learned: "Your level counts more for you" });
    expect(m.strength).toBeCloseTo(6 / LEARN.fullEach);
    const up = learnedNudge(m, why(10, 20));
    const down = learnedNudge(m, why(0, 20));
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
    expect(Math.abs(up)).toBeLessThanOrEqual(LEARN.maxNudge);
  });

  it("learns from the parts kept with a choice, after the posting is gone", () => {
    const kept = choices.map(({ why: w, ...c }) => ({ ...c, features: fitFeatures(w!) }));
    expect(learnOrder(kept, NOW)?.learned).toBe("Your level counts more for you");
  });

  it("switches itself off when the nudge doesn't help", () => {
    // The scores already separate liked from hidden perfectly: nothing left to learn.
    const separated = choices.map((c) => ({ ...c, score: c.status === "saved" ? 90 : 20 }));
    const m = learnOrder(separated, NOW)!;
    expect(m.helps).toBe(false);
    expect(learnedNudge(m, why(10, 20))).toBe(0);
  });

  it("weighs choices by what they say and lets old ones fade", () => {
    expect(choiceWeight({ status: "applied" }, NOW)).toEqual({ liked: true, weight: 1.5 });
    expect(choiceWeight({ status: "offer" }, NOW).weight).toBe(2);
    expect(choiceWeight({ status: "dismissed", reason: "company" }, NOW).weight).toBe(0);
    expect(choiceWeight({ status: "dismissed", reason: "other" }, NOW).weight).toBeCloseTo(0.3);
    expect(choiceWeight({ status: "saved", at: "2026-08-17T00:00:00Z" }, NOW).weight).toBeCloseTo(0.5);
  });

  it("leaves older scores and gated jobs alone", () => {
    const m = learnOrder(choices, NOW)!;
    expect(learnedNudge(m, { title: 30, location: 20, keywords: [], keywordPoints: 0 })).toBe(0);
    expect(learnedNudge(m, { ...why(10, 20), gate: "title" })).toBe(0);
    expect(learnedNudge(undefined, why(10, 20))).toBe(0);
  });
});
