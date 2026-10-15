import { describe, expect, it } from "vitest";
import { eligibilityOf, toDashboardJob } from "../src/dashboard";
import { regionOnly } from "../src/posting";
import type { Job } from "../src/schema";

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "lever:acme:1",
    ats: "lever",
    company: "Acme",
    title: "Product Manager",
    location: "Dubai",
    workplace: "unknown",
    url: "https://jobs.lever.co/acme/1",
    firstSeen: "2026-10-01T00:00:00Z",
    lastSeen: "2026-10-15T00:00:00Z",
    status: "open",
    score: 80,
    why: { title: 30, location: 20, keywords: [], keywordPoints: 0, industry: 10, scale: 100 / 60 },
    ...over,
  }) as Job;

describe("regionOnly", () => {
  it("reads the one region a title or location limits the job to", () => {
    expect(regionOnly("Product Owner (Fintech experienced)_cards aquiring CONTRACT (EU only)")).toBe("EU");
    expect(regionOnly("Remote - USA only")).toBe("US");
    expect(regionOnly("Remote (UK based only)")).toBe("UK");
    expect(regionOnly("Senior PM, India only")).toBe("India");
    expect(regionOnly("Remote, europe residents only")).toBe("Europe");
  });

  it("leaves titles without a limit alone", () => {
    expect(regionOnly("Head of Product")).toBeUndefined();
    expect(regionOnly("Product Manager, US Payments")).toBeUndefined();
    expect(regionOnly(undefined)).toBeUndefined();
  });
});

describe("eligibilityOf", () => {
  it("keeps only what the posting states", () => {
    expect(eligibilityOf(job(), "We build payments.")).toBeUndefined();
    expect(eligibilityOf(job({ title: "Product Owner (EU only)" }), undefined)).toEqual({ regionOnly: "EU" });
    expect(eligibilityOf(job(), "We are unable to sponsor visas for this role.")).toEqual({ sponsorship: "no" });
  });
});

describe("toDashboardJob pay", () => {
  it("reads pay from the description when the hiring system gives none", () => {
    const d = toDashboardJob(job({ description: "Compensation: base AED 28,000 - 32,000 per month" }));
    expect(d.salary).toEqual({ currency: "AED", min: 28000, max: 32000, period: "month" });
    expect(d.salaryFrom).toBe("description");
  });

  it("keeps the hiring system's own pay", () => {
    const d = toDashboardJob(job({ salary: { currency: "USD", min: 100000, max: 120000 }, description: "Salary: EUR 50,000 per year" }));
    expect(d.salary).toEqual({ currency: "USD", min: 100000, max: 120000 });
    expect(d.salaryFrom).toBeUndefined();
  });
});
