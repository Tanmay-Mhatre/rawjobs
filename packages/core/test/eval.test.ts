import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_DIR, evaluate, loadSet, ndcg, precisionAt, problems, spearman, tieRate, type Baseline } from "../eval/lib";

describe("matching eval set", () => {
  const set = loadSet();

  it("labels every profile x posting pair, 0..4 with a reason", () => {
    expect(problems(set)).toEqual([]);
    expect(set.profiles.length).toBeGreaterThanOrEqual(6);
    expect(set.jobs.length).toBeGreaterThanOrEqual(45);
  });

  it("gives every profile at least one strong job to find", () => {
    for (const p of set.profiles)
      expect(
        Object.values(set.labels[p.id]!).some((l) => l.label === 4),
        p.id,
      ).toBe(true);
  });

  it("doesn't rank worse than the baseline (NDCG@10 within 0.02)", () => {
    const base = JSON.parse(readFileSync(join(EVAL_DIR, "baseline.json"), "utf8")) as Baseline;
    expect(evaluate(set).overall.ndcg10).toBeGreaterThanOrEqual(base.overall.ndcg10 - 0.02);
  });

  it("doesn't bunch scores more than the baseline (tie rates within 0.02)", () => {
    const base = JSON.parse(readFileSync(join(EVAL_DIR, "baseline.json"), "utf8")) as Baseline;
    const now = evaluate(set).overall;
    expect(now.ties).toBeLessThanOrEqual(base.overall.ties + 0.02);
    expect(now.tiesNoTopics).toBeLessThanOrEqual(base.overall.tiesNoTopics + 0.02);
  });
});

describe("eval metrics", () => {
  const pairs = (xs: [number, number][]) => xs.map(([score, label]) => ({ score, label }));

  it("tie rate counts pairs of matched jobs with the same score", () => {
    expect(tieRate([90, 80, 70, 0, 0])).toBe(0);
    expect(tieRate([67, 67, 67])).toBe(1);
    expect(tieRate([67, 67, 75, 58])).toBeCloseTo(1 / 6);
  });

  it("NDCG is 1 for the ideal order and lower for a reversed one", () => {
    expect(
      ndcg(
        pairs([
          [90, 4],
          [50, 2],
          [10, 0],
        ]),
        5,
      ),
    ).toBe(1);
    expect(
      ndcg(
        pairs([
          [10, 4],
          [50, 2],
          [90, 0],
        ]),
        5,
      ),
    ).toBeLessThan(0.6);
  });

  it("averages ties, so the order of equal scores doesn't matter", () => {
    const a = ndcg(
      pairs([
        [50, 4],
        [50, 0],
      ]),
      1,
    );
    const b = ndcg(
      pairs([
        [50, 0],
        [50, 4],
      ]),
      1,
    );
    expect(a).toBe(b);
    expect(a).toBeCloseTo(0.5);
    expect(
      precisionAt(
        pairs([
          [50, 4],
          [50, 0],
          [10, 3],
        ]),
        1,
      ),
    ).toBeCloseTo(0.5);
  });

  it("Spearman is 1 for the same order and -1 for the opposite", () => {
    expect(
      spearman(
        pairs([
          [10, 0],
          [20, 1],
          [30, 2],
        ]),
      ),
    ).toBeCloseTo(1);
    expect(
      spearman(
        pairs([
          [30, 0],
          [20, 1],
          [10, 2],
        ]),
      ),
    ).toBeCloseTo(-1);
  });
});
