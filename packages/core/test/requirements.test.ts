import { describe, expect, it } from "vitest";
import { extractRequirements } from "../src/posting";

const posting = `About the role
You'll own payments for 40,000 merchants. We were founded 10 years ago.

What you'll do
- Run the payments roadmap
- Talk to merchants every week

What we're looking for
- 5+ years of product management experience, ideally in fintech
- Strong SQL; Python is a plus
- Clear writing

Nice to have
- KYC experience

Benefits
- 30 days holiday`;

describe("extractRequirements", () => {
  it("reads must and nice sections, and ends them at the next heading", () => {
    const r = extractRequirements(posting);
    expect(r.structured).toBe(true);
    expect(r.must).toEqual(["5+ years of product management experience", "Strong SQL", "Clear writing"]);
    expect(r.nice).toEqual(["ideally in fintech", "Python is a plus", "KYC experience"]);
    expect(r.rest).toContain("Run the payments roadmap");
    expect(r.rest).not.toMatch(/KYC|Python/);
  });

  it("reads the years the must-haves ask for, the highest minimum", () => {
    expect(extractRequirements(posting).years).toEqual({ min: 5, line: "5+ years of product management experience" });
    expect(extractRequirements("Requirements\n- 3-5 years in FP&A\n- 7+ years of finance experience, 2 managing people").years?.min).toBe(7);
    expect(extractRequirements("You have\n- At least five years of experience as a designer").years?.min).toBe(5);
    expect(extractRequirements("Requirements:\n- Minimum of 4 yrs in sales").years?.min).toBe(4);
  });

  it("doesn't read years that aren't experience", () => {
    expect(extractRequirements("Requirements\n- Our product is 10 years old\n- A 2-year contract").years).toBeUndefined();
    expect(extractRequirements("We were founded 12 years ago and you must love it.").years).toBeUndefined();
    expect(extractRequirements("Requirements\n- 0-2 years of experience").years).toBeUndefined();
  });

  it("sorts lines by cue words when there are no sections", () => {
    const r = extractRequirements("You must have 6 years of experience in sales. Salesforce is a plus.\nWe are a friendly team.");
    expect(r.structured).toBe(false);
    expect(r.must).toEqual(["You must have 6 years of experience in sales."]);
    expect(r.nice).toEqual(["Salesforce is a plus."]);
    expect(r.years?.min).toBe(6);
    expect(extractRequirements("Experience with Kafka is preferred.").nice).toEqual(["Experience with Kafka is preferred."]);
  });

  it("is empty for no text", () => {
    expect(extractRequirements(undefined)).toEqual({ must: [], nice: [], rest: "", structured: false });
  });
});
