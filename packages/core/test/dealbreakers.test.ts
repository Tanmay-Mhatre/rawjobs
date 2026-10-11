import { describe, expect, it } from "vitest";
import { avoidHit, countriesOfTerms, dealbreakers, salaryBreaker } from "../src/dealbreakers";
import { extractEligibility, extractPay, leadingPlace, normalizePeriod, payOf } from "../src/posting";
import { scoreJob } from "../src/score";
import { matchesTitle } from "../src/text";
import { profile } from "./helpers";

describe("extractPay", () => {
  it("reads a range with its currency and period", () => {
    expect(extractPay("Compensation: base AED 28,000 - 32,000 per month plus uncapped commission.")).toEqual({ currency: "AED", min: 28000, max: 32000, period: "month" });
    expect(extractPay("Salary: GBP 60,000 - 72,000 plus share options.")).toEqual({ currency: "GBP", min: 60000, max: 72000 });
    expect(extractPay("The range is €65k–€78k a year.")).toEqual({ currency: "EUR", min: 65000, max: 78000, period: "year" });
    expect(extractPay("Pay: SGD 5-6k/month")).toEqual({ currency: "SGD", min: 5000, max: 6000, period: "month" });
    expect(extractPay("Gehalt: 85.000 € brutto pro Jahr, salary 85.000 EUR per annum")).toMatchObject({ currency: "EUR", min: 85000 });
    expect(extractPay("Base salary $150,000 to $180,000 per year")).toEqual({ currency: "USD", min: 150000, max: 180000, period: "year" });
    expect(extractPay("Salary S$7,000 monthly")).toEqual({ currency: "SGD", min: 7000, period: "month" });
  });

  it("ignores amounts that aren't base pay, and lines that don't talk about pay", () => {
    expect(extractPay("We raised $40M in our Series B.")).toBeUndefined();
    expect(extractPay("You'll close deals with ACVs of USD 20-80k a year.")).toBeUndefined();
    expect(extractPay("Benefits: learning budget of €1,000 per year, home office stipend.")).toBeUndefined();
    expect(extractPay("Our customers process USD 2,000,000 through us.")).toBeUndefined();
    expect(extractPay("OTE of AED 50,000 per month.")).toBeUndefined();
    expect(extractPay(undefined)).toBeUndefined();
  });

  it("prefers the hiring system's own salary, and reads its period words", () => {
    expect(payOf({ salary: { min: 15000, max: 18000, currency: "aed", period: "MONTH" }, description: "Salary USD 1-2k" })).toEqual({ currency: "AED", min: 15000, max: 18000, period: "month" });
    expect(payOf({ salary: { min: 90000 }, description: "Salary EUR 90,000 - 100,000 per year" })).toEqual({ currency: "EUR", min: 90000, max: 100000, period: "year" });
    expect(normalizePeriod("YEARLY")).toBe("year");
    expect(normalizePeriod("per hour")).toBe("hour");
    expect(normalizePeriod("whenever")).toBeUndefined();
  });
});

describe("extractEligibility", () => {
  it("reads 'no sponsorship' and the country it's about", () => {
    const e = extractEligibility("Candidates must be authorised to work in the United States without current or future visa sponsorship. We are unable to sponsor visas for this role.");
    expect(e).toMatchObject({ sponsorship: "no", authorisedIn: "united states" });
    expect(extractEligibility("We are not able to offer relocation or visa sponsorship for this role.")).toMatchObject({ sponsorship: "no", relocation: "no" });
    expect(extractEligibility("No sponsorship is available.").sponsorship).toBe("no");
  });

  it("reads sponsorship on offer, and leaves 'maybe' as unknown", () => {
    expect(extractEligibility("We sponsor H-1B visas and transfers.").sponsorship).toBe("yes");
    expect(extractEligibility("Visa sponsorship is available for this role.").sponsorship).toBe("yes");
    expect(extractEligibility("We consider visa sponsorship for exceptional candidates.").sponsorship).toBe("unknown");
    expect(extractEligibility("Work with scheme partners and our BIN sponsors.").sponsorship).toBe("unknown");
    expect(extractEligibility("").sponsorship).toBe("unknown");
  });

  it("reads who must already live where", () => {
    expect(extractEligibility("This is a fully remote role, open to candidates living in the United States only.").residentIn).toBe("united states");
    expect(extractEligibility("Remote for US residents only.").residentIn).toBe("united states");
    expect(extractEligibility("You must already live in the Netherlands and have the right to work here.").residentIn).toBe("netherlands");
    // Not a residence rule: near a city, or a region too loose to act on.
    expect(extractEligibility("You must live within commuting distance of London.").residentIn).toBeUndefined();
    expect(extractEligibility("You must be based in the EU.").residentIn).toBeUndefined();
    expect(extractEligibility("This role requires you to be based in Riyadh. Relocation support is available.")).toMatchObject({ relocation: "yes" });
  });

  it("reads where the work is on site", () => {
    expect(extractEligibility("This role is based in our Amsterdam office five days a week.").onsiteIn).toBe("Amsterdam");
    expect(extractEligibility("On-site in our Tanjong Pagar office.").onsiteIn).toBeUndefined();
    expect(leadingPlace("the Netherlands and have the right")).toEqual({ place: "Netherlands", country: "netherlands" });
    expect(leadingPlace("U.S. only")).toMatchObject({ country: "united states" });
  });
});

describe("dealbreakers", () => {
  const base = { title: "Senior Product Manager", location: "Dubai", workplace: "hybrid" as const };

  it("salary: a top of range more than 5% under your floor, in your floor's period", () => {
    const floor = { amount: 25000, currency: "AED", period: "month" as const };
    expect(salaryBreaker({ currency: "AED", min: 15000, max: 18000, period: "month" }, floor)).toBe("Pay below your floor: up to AED 18k vs your 25k a month");
    expect(salaryBreaker({ currency: "AED", min: 20000, max: 24000, period: "month" }, floor)).toBeUndefined(); // within 5%
    expect(salaryBreaker({ currency: "AED", min: 20000, max: 30000, period: "month" }, floor)).toBeUndefined(); // straddles
    expect(salaryBreaker({ currency: "USD", max: 1000, period: "month" }, floor)).toBeUndefined(); // another currency
    expect(salaryBreaker(undefined, floor)).toBeUndefined();
    // A yearly posting against a monthly floor; and a period-less figure far too low to be in the same period.
    expect(salaryBreaker({ currency: "AED", max: 240000, period: "year" }, floor)).toBe("Pay below your floor: up to AED 20k vs your 25k a month");
    expect(salaryBreaker({ currency: "EUR", max: 6000 }, { amount: 85000, currency: "EUR", period: "year" })).toBeUndefined();
    expect(salaryBreaker({ currency: "EUR", max: 78000 }, { amount: 85000, currency: "EUR", period: "year" })).toBe("Pay below your floor: up to EUR 78k vs your 85k a year");
  });

  it("sponsorship: only when you set where you can work, and the job's country isn't one", () => {
    const job = { ...base, location: "Remote (US)", workplace: "remote" as const, description: "We are unable to sponsor visas for this role." };
    expect(dealbreakers(job, profile())).toEqual([]);
    expect(dealbreakers(job, profile({ work_authorization: ["none"] }))).toEqual(["No visa sponsorship, and you need one for the United States"]);
    expect(dealbreakers(job, profile({ work_authorization: ["usa"] }))).toEqual([]);
    expect(countriesOfTerms(["eu"], { eu: true }).has("germany")).toBe(true);
    expect(countriesOfTerms(["eu"]).size).toBe(0);
    expect(dealbreakers({ ...job, location: "Berlin", description: "We can't sponsor visas." }, profile({ work_authorization: ["eu"] }))).toEqual([]);
  });

  it("residence: a country you don't live in", () => {
    const job = { ...base, description: "Open to candidates living in the United States only." };
    expect(dealbreakers(job, profile())).toEqual(["Only for people already living in the United States"]);
    expect(dealbreakers({ ...job, description: "Open to candidates living in the UAE only." }, profile())).toEqual([]);
    // No home country to compare with: nothing.
    expect(dealbreakers(job, profile({ locations: { include: [], remote_ok: ["remote"], remote_exclude: [] } }))).toEqual([]);
  });

  it("avoid: in the title, or the role's own description, not a passing mention", () => {
    expect(avoidHit({ title: "Senior Financial Analyst, Credit Risk" }, "credit risk")).toBe(true);
    const web = "Our web app is React and TypeScript; a Go backend runs on Kubernetes.\n\nBuild features in React.\n\nExpert TypeScript and React.";
    expect(avoidHit({ title: "Senior Software Engineer (Web)", description: web }, "react")).toBe(true);
    expect(avoidHit({ title: "Senior Software Engineer (Web)", description: web }, "kubernetes")).toBe(false);
    // Twice, but the first well past the opening: a mention, not the role.
    expect(avoidHit({ title: "Platform Engineer", description: `${"x ".repeat(400)} frontend teams, frontend builds` }, "frontend")).toBe(false);
    expect(avoidHit({ title: "Platform Engineer", description: "We run accounts payable and receivable. 1-3 years in accounts payable." }, "accounts payable")).toBe(true);
  });
});

describe("scoreJob with dealbreakers", () => {
  const job = { title: "Senior Product Manager, Payments", location: "Dubai", workplace: "hybrid" as const, description: "Crypto payments, stablecoin exchange, KYC and tokenization." };

  it("halves the score, keeps it under min_score, and says why", () => {
    const clean = scoreJob(job, profile({ salary_floor: { amount: 25000, currency: "AED", period: "month" } }));
    expect(clean.why.dealbreakers).toBeUndefined();
    expect(clean.score).toBe(100);
    const low = scoreJob({ ...job, salary: { min: 15000, max: 18000, currency: "AED", period: "month" } }, profile({ salary_floor: { amount: 25000, currency: "AED", period: "month" } }));
    expect(low.score).toBe(50);
    expect(low.why.dealbreakers).toEqual(["Pay below your floor: up to AED 18k vs your 25k a month"]);
    // Halving alone would still be strong with a low threshold: it's kept under it.
    const avoid = scoreJob(job, profile({ avoid: ["payments"], min_score: 40 }));
    expect(avoid.score).toBe(39);
    expect(avoid.why.dealbreakers).toEqual(["About payments, which you avoid"]);
  });

  it("changes nothing for a profile without the new fields", () => {
    const withSalary = { ...job, salary: { min: 1000, max: 2000, currency: "AED", period: "month" } };
    expect(scoreJob(withSalary, profile())).toEqual(scoreJob(job, profile()));
  });

  it("never touches a job that failed a gate", () => {
    expect(scoreJob({ ...job, location: "London" }, profile({ avoid: ["payments"] })).why).toMatchObject({ gate: "location" });
    expect(scoreJob({ ...job, location: "London" }, profile({ avoid: ["payments"] })).why.dealbreakers).toBeUndefined();
  });
});

describe("title synonyms", () => {
  it("counts DevOps for platform, SRE and infrastructure titles, not the other way round between them", () => {
    expect(matchesTitle("Senior DevOps Engineer", ["platform engineer"])).toBe(true);
    expect(matchesTitle("DevOps Engineer II", ["site reliability engineer"])).toBe(true);
    expect(matchesTitle("DevOps Engineers", ["infrastructure engineer"])).toBe(true);
    expect(matchesTitle("Platform Engineer", ["devops engineer"])).toBe(true);
    expect(matchesTitle("Site Reliability Engineer", ["platform engineer"])).toBe(false);
    expect(matchesTitle("DevOps Manager", ["platform engineer"])).toBe(false);
  });
});
