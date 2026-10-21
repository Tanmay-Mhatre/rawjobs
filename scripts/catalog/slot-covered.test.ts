import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module (runs in CI without an install), no type declarations
import { coveredByRuns, cronMatches, cronsOf, slotStart } from "./slot-covered.mjs";

const t = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("slot-covered", () => {
  it("reads the crons out of a workflow", () => {
    expect(cronsOf("on:\n  schedule:\n    - cron: \"23 */6 * * *\"\n    - cron: '7 3 * * 1'\n")).toEqual(["23 */6 * * *", "7 3 * * 1"]);
  });

  it("matches cron fields like GitHub", () => {
    expect(cronMatches("17 */3 * * *", t("2026-10-21T15:17:00Z"))).toBe(true);
    expect(cronMatches("17 */3 * * *", t("2026-10-21T16:17:00Z"))).toBe(false);
    expect(cronMatches("47 13 * * 1", t("2026-10-19T13:47:00Z"))).toBe(true); // a Monday
    expect(cronMatches("41 3 * * 0", t("2026-10-25T03:41:00Z"))).toBe(true); // a Sunday
  });

  it("puts the Worker's dispatch and a late cron run in the same slot", () => {
    const crons = ["23 */6 * * *"];
    expect(iso(slotStart(crons, t("2026-10-21T12:13:13Z")))).toBe("2026-10-21T12:13:00.000Z"); // Worker at :13
    expect(iso(slotStart(crons, t("2026-10-21T12:23:40Z")))).toBe("2026-10-21T12:13:00.000Z"); // cron on time
    expect(iso(slotStart(crons, t("2026-10-21T16:57:00Z")))).toBe("2026-10-21T12:13:00.000Z"); // cron 4.5 h late
    expect(iso(slotStart(crons, t("2026-10-21T18:14:00Z")))).toBe("2026-10-21T18:13:00.000Z"); // next slot's Worker
  });

  it("finds a weekly slot days back, and none without a cron", () => {
    expect(iso(slotStart(["47 13 * * 1"], t("2026-10-21T09:00:00Z")))).toBe("2026-10-19T13:37:00.000Z");
    expect(slotStart([], t("2026-10-21T09:00:00Z"))).toBe(null);
  });

  it("counts queued, running and successful runs as covering, never itself", () => {
    const start = t("2026-10-21T12:13:00Z");
    const run = (id: number, createdAt: string, status: string, conclusion = "") => ({ databaseId: id, createdAt, status, conclusion });
    expect(coveredByRuns([run(1, "2026-10-21T12:13:10Z", "queued")], 2, start)?.databaseId).toBe(1);
    expect(coveredByRuns([run(1, "2026-10-21T12:13:10Z", "completed", "success")], 2, start)?.databaseId).toBe(1);
    expect(coveredByRuns([run(1, "2026-10-21T12:13:10Z", "completed", "cancelled")], 2, start)).toBeUndefined();
    expect(coveredByRuns([run(1, "2026-10-21T12:13:10Z", "completed", "failure")], 2, start)).toBeUndefined();
    expect(coveredByRuns([run(2, "2026-10-21T12:13:10Z", "in_progress")], 2, start)).toBeUndefined(); // itself
    expect(coveredByRuns([run(1, "2026-10-21T12:00:00Z", "completed", "success")], 2, start)).toBeUndefined(); // previous slot
  });
});
