import { describe, expect, it } from "vitest";
import { checkOrder } from "./check";
import { dueKind, isCurrent, mergeCheck, retryWaitDays, spreadDays } from "./lib/checks";

const board = (key: string, confidence: "high" | "single", sources: string[] = []) => ({ key, ats: "workable", slug: key, confidence, sources });

describe("check order", () => {
  it("checks boards users shared first, then the ones several sources agree on", () => {
    const boards = [board("single", "single"), board("high", "high"), board("shared", "single", ["contrib"]), board("shared-high", "high", ["latmay", "contrib"])];
    expect(boards.sort(checkOrder).map((b) => b.key)).toEqual(["shared-high", "shared", "high", "single"]);
  });
});

describe("recheck spread", () => {
  const DAY = 86_400_000;
  const checked = (key: string, daysAgo: number, status = "live") => ({ key, status, checked_at: new Date(Date.parse("2026-11-10T00:00:00Z") - daysAgo * DAY).toISOString() });
  const now = Date.parse("2026-11-10T00:00:00Z");

  it("keeps a result for 30 days plus the board's own 0-6 days, then it's due", () => {
    const key = "greenhouse:acme";
    const extra = spreadDays(key);
    expect(isCurrent(checked(key, 29), 30, now)).toBe(true);
    expect(isCurrent(checked(key, 30 + extra - 0.5), 30, now)).toBe(true);
    expect(isCurrent(checked(key, 30 + extra), 30, now)).toBe(false);
  });

  it("a fresh error waits a day before its retry, and without --recheck-days nothing definite is due", () => {
    expect(isCurrent(checked("lever:a", 0, "error"), 30, now)).toBe(true);
    expect(isCurrent(checked("lever:a", 1, "error"), 30, now)).toBe(false);
    expect(isCurrent(checked("lever:a", 400), Infinity, now)).toBe(true);
  });

  it("spreads boards checked on the same day over the whole week", () => {
    const counts = Array.from({ length: 7 }, () => 0);
    for (let i = 0; i < 7000; i++) counts[spreadDays(`greenhouse:company-${i}`)]!++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
    expect(spreadDays("greenhouse:acme")).toBe(spreadDays("greenhouse:acme"));
  });
});

describe("retry back-off", () => {
  const DAY = 86_400_000;
  const now = Date.parse("2026-11-10T00:00:00Z");
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

  it("waits 1, 2, 4, 8, 16, then at most 30 days between retries", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryWaitDays)).toEqual([1, 2, 4, 8, 16, 30, 30]);
  });

  it("counts errors in a row, keeps a definite answer, and resets on the next one", () => {
    let r = mergeCheck(undefined, { key: "bamboohr:x", status: "live", checked_at: at(40) });
    r = mergeCheck(r, { key: "bamboohr:x", status: "error", checked_at: at(10) });
    r = mergeCheck(r, { key: "bamboohr:x", status: "error", checked_at: at(3) });
    expect(r).toMatchObject({ status: "live", checked_at: at(40), errors: 2, last_error_at: at(3) });
    // Two errors in a row: next retry 2 days after the last one.
    expect(isCurrent(r, 30, now)).toBe(false);
    expect(isCurrent(r, 30, now - 2 * DAY)).toBe(true);
    r = mergeCheck(r, { key: "bamboohr:x", status: "dead", checked_at: at(0) });
    expect(r.errors).toBeUndefined();
  });

  it("a board that only ever failed backs off too (older rows without a count count as one)", () => {
    const r = mergeCheck({ key: "freshteam:y", status: "error", checked_at: at(20) }, { key: "freshteam:y", status: "error", checked_at: at(5) });
    expect(r.errors).toBe(2);
    expect(isCurrent(r, 30, now)).toBe(false);
    expect(isCurrent({ key: "freshteam:y", status: "error", checked_at: at(0.5) }, 30, now)).toBe(true);
  });

  it("checks never-checked boards before monthly rechecks, and retries last", () => {
    const b = (key: string, due: "new" | "recheck" | "retry", confidence: "high" | "single" = "high") => ({ key, ats: "workable", slug: key, confidence, due });
    const boards = [b("retry", "retry"), b("recheck", "recheck"), b("new-single", "new", "single"), b("new", "new")];
    expect(boards.sort(checkOrder).map((x) => x.key)).toEqual(["new", "new-single", "recheck", "retry"]);
    expect(dueKind(undefined)).toBe("new");
    expect(dueKind({ key: "a", status: "live", checked_at: at(40) })).toBe("recheck");
    expect(dueKind({ key: "a", status: "live", checked_at: at(40), errors: 1 })).toBe("retry");
  });
});
