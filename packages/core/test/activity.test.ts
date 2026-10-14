import { describe, expect, it } from "vitest";
import {
  activityMonths,
  addMonths,
  baselineReady,
  dayNumber,
  dayString,
  hiringSummary,
  isSurge,
  monthsBetween,
  paceLabel,
  recordedDays,
  roleKind,
  usualPace,
  type ActivityFile,
  type CompanyActivity,
} from "../src/activity";

describe("role kinds", () => {
  it.each([
    ["Software Engineering Intern", "internship"],
    ["Summer Internship 2027 - Data", "internship"],
    ["Co-op, Mechanical Engineering", "internship"],
    ["Werkstudent Marketing (m/w/d)", "internship"],
    ["Summer Analyst, Investment Banking", "internship"],
    ["Graduate Software Engineer", "graduate"],
    ["New Grad, Backend", "graduate"],
    ["Early Careers Programme - Finance", "graduate"],
    ["Apprentice Electrician", "graduate"],
    ["Software Engineer", "experienced"],
    ["Internal Audit Manager", "experienced"],
    ["International Sales Lead", "experienced"],
    ["Senior Graduate Recruiter", "experienced"],
    ["Campus Recruiter", "experienced"],
    ["Intern Program Coordinator", "experienced"],
    ["Head of Early Careers", "experienced"],
  ] as const)("%s is %s", (title, kind) => expect(roleKind(title)).toBe(kind));
});

describe("days and months", () => {
  it("counts days and months across year ends", () => {
    expect(dayString(dayNumber("2026-10-14"))).toBe("2026-10-14");
    expect(dayNumber("2026-10-14T23:59:00Z") - dayNumber("2026-10-13")).toBe(1);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 13)).toBe("2027-01");
    expect(monthsBetween("2025-10", "2026-10")).toBe(12);
    expect(activityMonths("2026-10-14")).toHaveLength(13);
    expect(activityMonths("2026-10-14")[0]).toBe("2025-10");
    expect(activityMonths("2026-10-14", 12).at(-1)).toBe("2026-10");
  });
});

/** 13 monthly values, oldest first, from a partial list ending this month. */
const months = (...last: number[]) => [...Array(13 - last.length).fill(0), ...last];

describe("pace, baseline and surge", () => {
  it("is ready after 42 days of records, not before", () => {
    expect(recordedDays(null, "2026-10-14")).toBe(0);
    expect(recordedDays("2026-10-14", "2026-10-14")).toBe(1);
    expect(baselineReady("2026-09-03", "2026-10-14")).toBe(true); // 42 days
    expect(baselineReady("2026-09-04", "2026-10-14")).toBe(false); // 41 days
    expect(baselineReady(null, "2026-10-14")).toBe(false);
  });

  it("averages the days recorded before the last 30, scaled to 30 days", () => {
    // Since 1 Aug: 74 days to 13 Oct, 44 of them before the last 30. 22 roles then -> 15 per 30 days.
    const c = { m: months(10, 12, 20), n: 20 };
    expect(usualPace(c, "2026-08-01", "2026-10-13", "2025-10")).toBeCloseTo((22 / 44) * 30);
    // Records older than the first kept month don't count: only the months kept are averaged.
    expect(usualPace({ m: months(30), n: 0 }, "2024-01-01", "2026-10-13", "2025-10")).toBeCloseTo((30 / (dayNumber("2026-10-13") - 30 - dayNumber("2025-10-01") + 1)) * 30);
    expect(usualPace(c, "2026-09-10", "2026-10-13", "2025-10")).toBeUndefined();
    expect(usualPace({ n: 0 }, "2026-08-01", "2026-10-13", "2025-10")).toBe(0);
  });

  it("is a surge at twice the usual pace and at least 5 roles", () => {
    expect(isSurge(10, 5, { ready: true })).toBe(true);
    expect(isSurge(9, 5, { ready: true })).toBe(false);
    expect(isSurge(4, 1, { ready: true })).toBe(false);
    expect(isSurge(5, 0, { ready: true })).toBe(true);
    expect(isSurge(10, 5, { ready: false })).toBe(false);
    expect(isSurge(10, 5, { ready: true, evergreen: true })).toBe(false);
    expect(isSurge(10, undefined, { ready: true })).toBe(false);
  });

  it("rounds the pace to halves below 3 and whole numbers above", () => {
    expect(paceLabel(1.6)).toBe("1.5×");
    expect(paceLabel(2.24)).toBe("2×");
    expect(paceLabel(2.8)).toBe("3×");
    expect(paceLabel(3.4)).toBe("3×");
    expect(paceLabel(11.6)).toBe("12×");
  });
});

describe("hiringSummary", () => {
  const file = (since: string | null, date = "2026-10-13"): Pick<ActivityFile, "date" | "since" | "first_month"> => ({ date, since, first_month: activityMonths(date)[0]! });

  it("uses posted dates until 30 days are recorded", () => {
    const c: CompanyActivity = { m: months(3), n: 3, p: 7 };
    const s = hiringSummary(c, file("2026-10-01"));
    expect(s).toMatchObject({ last30: 7, basis: "posted", baselineReady: false, surge: false, since: "2026-10-01" });
    expect(s.usual).toBeUndefined();
    // Months before records started are null; this month counts.
    expect(s.months).toHaveLength(12);
    expect(s.months.at(-1)).toEqual({ month: "2026-10", count: 3 });
    expect(s.months.at(-2)).toEqual({ month: "2026-09", count: null });
  });

  it("before anything is counted, shows posted roles and no bars", () => {
    const s = hiringSummary({ n: 0, p: 2 }, file(null));
    expect(s).toMatchObject({ last30: 2, basis: "posted", since: "2026-10-13", baselineReady: false });
    expect(s.months.every((m) => m.count === null)).toBe(true);
    expect(hiringSummary({ n: 0 }, file(null)).last30).toBeUndefined();
  });

  it("counts new roles after 30 days and compares after 42", () => {
    const c: CompanyActivity = { m: months(2, 3, 4, 14), n: 14 };
    const notYet = hiringSummary(c, file("2026-09-05"));
    expect(notYet).toMatchObject({ last30: 14, basis: "new", baselineReady: false, surge: false });
    const ready = hiringSummary(c, file("2026-07-20"));
    expect(ready).toMatchObject({ last30: 14, basis: "new", baselineReady: true, surge: true });
    expect(ready.usual).toBeGreaterThan(0);
    expect(ready.pace).toBeCloseTo(14 / ready.usual!);
    expect(ready.months.slice(-4).map((m) => m.count)).toEqual([2, 3, 4, 14]);
  });

  it("a company counted from later than the file starts uses its own start", () => {
    const s = hiringSummary({ m: months(6), n: 6, s: "2026-10-05" }, file("2026-07-01"));
    expect(s).toMatchObject({ since: "2026-10-05", basis: "posted", baselineReady: false });
  });

  it("a mass poster is never a surge", () => {
    const c: CompanyActivity = { m: months(1, 1, 1, 40), n: 40, e: 1 };
    expect(hiringSummary(c, file("2026-07-20")).surge).toBe(false);
  });
});
