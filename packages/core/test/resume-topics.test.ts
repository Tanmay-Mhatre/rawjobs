import { describe, expect, it } from "vitest";
import { resumeTopics } from "../src/resume-topics";

const resume = `# Sam Example
## Experience
### Senior Product Manager, Ledgerline (2022 - present)
- Led payments: PSP integrations, acquiring and payouts across 12 markets.
- Shipped card issuing with our BIN sponsor; cut chargebacks 30%.
- Ran A/B testing on checkout.
### Product Manager, Kroonpay (2019 - 2022)
- Owned KYC onboarding and AML transaction monitoring.
## Skills
SQL, Figma, experimentation`;

describe("resumeTopics", () => {
  it("takes topics the résumé names at least twice, with more weight for more mentions", () => {
    const t = resumeTopics(resume);
    expect(t.payments).toBeGreaterThanOrEqual(3);
    expect(t.cards).toBeGreaterThanOrEqual(2);
    expect(t.compliance).toBe(2);
    // Named once: not enough evidence.
    expect(t.figma).toBeUndefined();
    expect(Object.keys(t).length).toBeLessThanOrEqual(12);
  });

  it("gives nothing for an empty résumé", () => {
    expect(resumeTopics("")).toEqual({});
    expect(resumeTopics(null)).toEqual({});
  });
});
