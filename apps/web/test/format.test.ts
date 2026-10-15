import { describe, expect, it } from "vitest";
import { cleanLocation, companyName, eligibilityNotes, jobTitle, workplaceBeside } from "../src/lib/format";

describe("job display helpers", () => {
  it("says a place once", () => {
    expect(cleanLocation("Remote, Remote")).toBe("Remote");
    expect(cleanLocation("Berlin, remote, Remote")).toBe("Berlin, Remote");
    expect(workplaceBeside("Remote", "Remote")).toBeNull();
    expect(workplaceBeside("Dubai", "Hybrid")).toBe("Hybrid");
    expect(workplaceBeside("Dubai", null)).toBeNull();
  });

  it("writes a company typed in capitals the usual way, and keeps acronyms", () => {
    expect(companyName("WISE INTEGRATION")).toBe("Wise Integration");
    expect(companyName("HSBC")).toBe("HSBC");
    expect(companyName("Leading Edge")).toBe("Leading Edge");
  });

  it("drops stray underscores from titles", () => {
    expect(jobTitle("Product Owner (Fintech experienced)_cards aquiring")).toBe("Product Owner (Fintech experienced) cards aquiring");
  });

  it("puts limits on who can take the job first", () => {
    expect(eligibilityNotes({ sponsorship: "yes", regionOnly: "EU" })).toEqual([
      { text: "EU only", limit: true },
      { text: "Sponsors a visa", limit: false },
    ]);
    expect(eligibilityNotes({ residentIn: "united states" })[0]?.text).toBe("Must live in United States");
    expect(eligibilityNotes(undefined)).toEqual([]);
  });
});
