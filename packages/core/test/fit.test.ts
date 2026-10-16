import { describe, expect, it } from "vitest";
import { fitLine } from "../src/fit";
import type { ScoreBreakdown } from "../src/schema";

const why = (o: Partial<ScoreBreakdown> = {}): ScoreBreakdown => ({
  title: 30,
  level: 10,
  focus: 1,
  location: 20,
  keywords: [],
  keywordPoints: 0,
  checks: [{ id: "place", status: "met", note: "In one of your places" }],
  ...o,
});

describe("fitLine", () => {
  it("names the best reasons, at most two", () => {
    expect(fitLine(why({ keywords: ["payments", "cards", "kyc"], checks: [{ id: "level", status: "met", note: "At your level" }] })).reason).toBe("payments, cards · Your title and level");
    expect(fitLine(why()).reason).toBe("Your title · In your place");
    expect(fitLine(why({ focus: 0.5, checks: [{ id: "level", status: "met", note: "At your level" }] })).reason).toBe("Your level · In your place");
    expect(fitLine(why({ location: 15, focus: 0.5 })).reason).toBe("Remote for you");
  });

  it("shows a missed check before an unknown one, and unknown is never a reason", () => {
    const checks: ScoreBreakdown["checks"] = [
      { id: "visa", status: "unknown", note: "Doesn't say if it sponsors visas" },
      { id: "level", status: "missed", note: "Head, Director & VP: not your level" },
    ];
    expect(fitLine(why({ checks })).gap).toEqual({ text: "Not your level", tone: "missed" });
    expect(fitLine(why({ checks: [checks[0]!] }))).toEqual({ reason: "Your title", gap: { text: "Visa not stated", tone: "unknown" } });
  });

  it("names missing topics when few matched, but not on estimated jobs", () => {
    const w = why({ missing: ["payments", "cards"], keywordPoints: 10 });
    expect(fitLine(w).gap).toEqual({ text: "No payments, cards", tone: "missed" });
    expect(fitLine(w, { estimated: true }).gap).toBeUndefined();
  });

  it("leaves gated jobs, dealbreakers and older scores to the row's own flag", () => {
    expect(fitLine(why({ gate: "title" }))).toEqual({});
    expect(fitLine(why({ checks: undefined }))).toEqual({});
    expect(fitLine(why({ dealbreakers: ["Pay below your floor"], checks: [{ id: "pay", status: "missed", note: "Pay below your floor" }] })).gap).toBeUndefined();
  });
});
