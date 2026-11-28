import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedHome, shiftDates } from "./seed-home";

let home = "";
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = "";
});

describe("the e2e seed", () => {
  it("moves every ISO timestamp and leaves other values alone", () => {
    const day = 86_400_000;
    expect(shiftDates({ at: "2026-06-15T09:00:00.000Z", list: ["2026-06-14T09:00:00Z", "June"], n: 3 }, day)).toEqual({
      at: "2026-06-16T09:00:00.000Z",
      list: ["2026-06-15T09:00:00.000Z", "June"],
      n: 3,
    });
  });

  it("writes a config, a résumé and scan results dated around today", () => {
    home = mkdtempSync(join(tmpdir(), "rawjobs-seed-"));
    seedHome(home, { now: new Date("2027-01-10T12:00:00.000Z") });
    expect(existsSync(join(home, "rawjobs.config.local.yaml"))).toBe(true);
    expect(readFileSync(join(home, "profile/resume.md"), "utf8")).toContain("#");
    const jobs = JSON.parse(readFileSync(join(home, "data/jobs.json"), "utf8")) as { generatedAt: string; jobs: unknown[] };
    expect(jobs.jobs.length).toBeGreaterThan(0);
    expect(jobs.generatedAt.slice(0, 7)).toBe("2027-01");
  });

  it("leaves the folder empty for a first run", () => {
    home = mkdtempSync(join(tmpdir(), "rawjobs-seed-"));
    seedHome(home, { empty: true });
    expect(readdirSync(home)).toEqual([]);
  });
});
