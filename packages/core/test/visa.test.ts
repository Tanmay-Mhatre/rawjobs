import { describe, expect, it } from "vitest";
import { cleanVisa, sponsorOf, sponsorSentence, sponsorTitle, visaCountryOf, visaListLabel, visaPeriodLabel } from "../src/catalog/visa";

describe("visa sponsors", () => {
  it("maps the job's country name to the register's country", () => {
    expect(visaCountryOf("United Kingdom")).toBe("GB");
    expect(visaCountryOf("united states")).toBe("US");
    expect(visaCountryOf("Canada")).toBe("CA");
    expect(visaCountryOf("Netherlands")).toBe("NL");
    expect(visaCountryOf("Germany")).toBeUndefined();
    expect(visaCountryOf("Remote")).toBeUndefined();
  });

  it("says when a list is from", () => {
    expect(visaPeriodLabel("2026-10-09")).toBe("9 Oct 2026");
    expect(visaPeriodLabel("FY2025")).toBe("fiscal year 2025");
    expect(visaPeriodLabel("2026Q2")).toBe("Apr–Jun 2026");
    expect(visaListLabel("2026-10-09")).toBe("list of 9 Oct 2026");
    expect(visaListLabel("FY2025")).toBe("list for fiscal year 2025");
  });

  it("shows the badge only for a country the company is on a register for", () => {
    const visa = { GB: "2026-10-09", US: "FY2026" };
    expect(sponsorOf([{ countries: ["United Kingdom"], visa }])).toEqual({ country: "GB", period: "2026-10-09" });
    expect(sponsorOf([{ countries: ["Germany"], visa }])).toBeUndefined();
    expect(sponsorOf([{ countries: [], visa }])).toBeUndefined();
    expect(sponsorOf([{ countries: ["United Kingdom"] }])).toBeUndefined();
    // A role in several places: any posting's country counts.
    expect(
      sponsorOf([
        { countries: ["Germany"], visa },
        { countries: ["United States"], visa },
      ]),
    ).toEqual({ country: "US", period: "FY2026" });
    // One posting naming several countries.
    expect(sponsorOf([{ countries: ["Ireland", "United Kingdom"], visa }])?.country).toBe("GB");
  });

  it("words the tooltip and the job page line", () => {
    expect(sponsorTitle({ country: "GB", period: "2026-10-09" })).toBe("On the UK register of licensed sponsors (Skilled Worker), list of 9 Oct 2026. Ask whether this role is open to sponsorship.");
    expect(sponsorSentence("Acme", { country: "US", period: "FY2026" })).toBe("Acme is on the USCIS list of H-1B employers with approvals, list for fiscal year 2026.");
  });

  it("keeps only known countries from the directory", () => {
    expect(cleanVisa({ GB: "2026-10-09", XX: "1", US: 5 })).toEqual({ GB: "2026-10-09" });
    expect(cleanVisa({})).toBeUndefined();
    expect(cleanVisa("GB")).toBeUndefined();
    expect(cleanVisa(undefined)).toBeUndefined();
  });
});
