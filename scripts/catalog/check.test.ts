import { describe, expect, it } from "vitest";
import { checkOrder, isCurrent, spreadDays } from "./check";

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

  it("errors are always due, and without --recheck-days nothing definite is", () => {
    expect(isCurrent(checked("lever:a", 0, "error"), 30, now)).toBe(false);
    expect(isCurrent(checked("lever:a", 400), Infinity, now)).toBe(true);
  });

  it("spreads boards checked on the same day over the whole week", () => {
    const counts = Array.from({ length: 7 }, () => 0);
    for (let i = 0; i < 7000; i++) counts[spreadDays(`greenhouse:company-${i}`)]!++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
    expect(spreadDays("greenhouse:acme")).toBe(spreadDays("greenhouse:acme"));
  });
});
