import { describe, expect, it } from "vitest";
import type { RunSummary } from "../src/lib/data";
import { firstSeenFrom, STAR_AFTER_DAYS, STAR_AGAIN_DAYS, STAR_SCANS, starDue, starFacts } from "../src/lib/starPrompt";
import type { Entry, UserState } from "../src/lib/userState";

const DAY = 86_400_000;
const now = Date.parse("2026-10-22T10:00:00.000Z");
const ago = (days: number) => new Date(now - days * DAY).toISOString();
const run = (at: string) => ({ startedAt: at, finishedAt: at }) as RunSummary;
const runs = (n: number) => Array.from({ length: n }, (_, i) => run(ago(i)));
const snapshot = { title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };
const entry = (o: Partial<Entry>): Entry => ({ status: "saved", updatedAt: ago(1), snapshot, ...o });

describe("starFacts", () => {
  it("counts jobs applied to, now or at some point, but not saved or dismissed ones", () => {
    const state: UserState = {
      a: entry({ status: "applied" }),
      b: entry({ status: "interviewing" }),
      c: entry({
        status: "rejected",
        history: [
          { status: "applied", at: ago(9) },
          { status: "rejected", at: ago(2) },
        ],
      }),
      d: entry({ status: "rejected" }),
      e: entry({ status: "saved" }),
      f: entry({ status: "dismissed" }),
    };
    expect(starFacts({ firstSeen: ago(10) }, state, runs(3), now)).toEqual({ days: 10, scans: 3, applied: 3 });
  });
});

describe("starDue", () => {
  const used = { days: STAR_AFTER_DAYS, scans: 0, applied: 1 };

  it("waits for a week of use and something gained from it", () => {
    expect(starDue({}, used, now)).toBe(true);
    expect(starDue({}, { ...used, days: STAR_AFTER_DAYS - 1 }, now)).toBe(false);
    expect(starDue({}, { ...used, applied: 0 }, now)).toBe(false);
    expect(starDue({}, { ...used, applied: 0, scans: STAR_SCANS }, now)).toBe(true);
  });

  it("never asks again once answered", () => {
    expect(starDue({ answer: "starred" }, used, now)).toBe(false);
    expect(starDue({ answer: "never" }, used, now)).toBe(false);
  });

  it("asks once more a month after Remind me later, then stops", () => {
    expect(starDue({ later: [ago(STAR_AGAIN_DAYS - 1)] }, used, now)).toBe(false);
    expect(starDue({ later: [ago(STAR_AGAIN_DAYS)] }, used, now)).toBe(true);
    expect(starDue({ later: [ago(90), ago(STAR_AGAIN_DAYS)] }, used, now)).toBe(false);
  });
});

describe("firstSeenFrom", () => {
  it("takes the earliest scan or tracking change", () => {
    const state: UserState = { a: entry({ updatedAt: ago(3), history: [{ status: "saved", at: ago(20) }] }) };
    expect(firstSeenFrom(state, [run(ago(12))], now)).toBe(ago(20));
    expect(firstSeenFrom({}, [run(ago(12))], now)).toBe(ago(12));
  });

  it("is now for someone new", () => {
    expect(firstSeenFrom({}, [], now)).toBe(new Date(now).toISOString());
  });
});
