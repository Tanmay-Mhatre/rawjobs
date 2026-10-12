import { describe, expect, it } from "vitest";
import { coverageLine, initialCompaniesTab } from "../src/lib/companiesPage";
import type { ScanPlan } from "../src/lib/setup";

describe("initialCompaniesTab", () => {
  it("opens on Suggestions with 0 companies, whatever tab was remembered", () => {
    for (const stored of [null, "mine", "browse", "suggestions"]) expect(initialCompaniesTab({ attention: false, stored, companies: 0 })).toBe("suggestions");
  });

  it("opens on the remembered tab when there are companies, else My companies", () => {
    expect(initialCompaniesTab({ attention: false, stored: "browse", companies: 3 })).toBe("browse");
    expect(initialCompaniesTab({ attention: false, stored: "suggestions", companies: 3 })).toBe("suggestions");
    expect(initialCompaniesTab({ attention: false, stored: null, companies: 3 })).toBe("mine");
    expect(initialCompaniesTab({ attention: false, stored: "nonsense", companies: 3 })).toBe("mine");
  });

  it("opens My companies when a failing link was followed", () => {
    expect(initialCompaniesTab({ attention: true, stored: "browse", companies: 3 })).toBe("mine");
    expect(initialCompaniesTab({ attention: true, stored: null, companies: 0 })).toBe("mine");
  });
});

const plan = (mine: [number, number], all: [number, number] = [mine[0], 17_000]): ScanPlan => ({
  mine: { yours: mine[0], extra: mine[1], seconds: 60, resumable: null },
  all: { yours: all[0], extra: all[1], seconds: 3600, resumable: null },
});
const line = (p: ScanPlan, industries: number, o: { scope?: "mine" | "all"; hasJobs?: boolean } = {}) => coverageLine({ plan: p, scope: o.scope ?? "mine", industries, hasJobs: o.hasJobs ?? false });

describe("coverageLine", () => {
  it("counts your companies and the ones your industries add", () => {
    expect(line(plan([12, 175]), 3)).toBe("Right now: your 12 companies plus 175 in your 3 industries.");
    expect(line(plan([1, 1]), 1)).toBe("Right now: your 1 company plus 1 in your industry.");
    expect(line(plan([1_204, 2_500]), 13)).toBe("Right now: your 1,204 companies plus 2,500 in your 13 industries.");
  });

  it("says only your companies when industries add none", () => {
    expect(line(plan([4, 0]), 0)).toBe("Right now: your 4 companies.");
    expect(line(plan([4, 0]), 2)).toBe("Right now: your 4 companies.");
  });

  it("with no companies, says what industries cover and that anything outside them is missed", () => {
    expect(line(plan([0, 175]), 13)).toBe("Right now: 175 companies in your 13 industries. Add companies to cover any outside them.");
  });

  it("with nothing covered, says the Radar stays empty, or gets nothing new when it holds older jobs", () => {
    expect(line(plan([0, 0]), 0)).toBe("Right now: 0 companies, so your Radar stays empty.");
    expect(line(plan([0, 0]), 0, { hasJobs: true })).toBe("Right now: 0 companies, so scans find no new jobs.");
  });

  it("follows an All companies default scan", () => {
    expect(line(plan([0, 0], [5, 17_000]), 0, { scope: "all" })).toBe("Right now: your 5 companies plus 17,000 more from the directory.");
    expect(line(plan([0, 0], [0, 17_000]), 0, { scope: "all" })).toBe("Right now: 17,000 companies from the directory.");
  });
});
