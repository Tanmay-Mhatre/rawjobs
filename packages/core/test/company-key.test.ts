import { describe, expect, it } from "vitest";
import * as keys from "../src/connectors/keys";
import { careersUrl, companyKey, connectors, SUPPORTED_ATS } from "../src/connectors";
import type { DetectedCompany } from "../src/connectors";

// `@rawjobs/core/company-key` (keys.ts) is the light copy the web app loads instead of every
// connector; it must agree with the connector registry and with the `/detect` exports.

const companies: DetectedCompany[] = [
  { ats: "greenhouse", slug: "stripe" },
  { ats: "greenhouse", slug: "acme", region: "eu" },
  { ats: "lever", slug: "kraken" },
  { ats: "workday", slug: "Nvidia", shard: "wd5", site: "NVIDIAExternalCareerSite" },
  { ats: "taleo", slug: "acme", site: "2" },
  { ats: "teamtailor", slug: "careers.acme.com" },
  { ats: "teamtailor", slug: "acme" },
  { ats: "zoho", slug: "acme", shard: "eu" },
  { ats: "zoho", slug: "acme", shard: "nope" },
  { ats: "successfactors", slug: "jobs.acme.com" },
  { ats: "successfactors", slug: "Acme", shard: "career4.successfactors.com" },
  { ats: "taleobe", slug: "ACME", shard: "chk.tbe.taleo.net/chk01", site: "4" },
  { ats: "taleobe", slug: "ACME" },
];

describe("company-key", () => {
  it("SUPPORTED_ATS lists exactly the connectors that exist", () => {
    expect([...SUPPORTED_ATS].sort()).toEqual(Object.keys(connectors).sort());
    expect(keys.SUPPORTED_ATS).toBe(SUPPORTED_ATS);
  });

  it("careersUrl and companyKey are the same through both exports", () => {
    expect(keys.careersUrl).toBe(careersUrl);
    expect(keys.companyKey).toBe(companyKey);
    for (const c of companies) {
      expect(keys.careersUrl(c)).toBe(careersUrl(c));
      expect(keys.companyKey(c)).toBe(companyKey(c));
    }
  });

  it("keeps the addresses the helpers build", () => {
    expect(companyKey(companies[3]!)).toBe("workday:nvidia|wd5|nvidiaexternalcareersite");
    expect(careersUrl(companies[5]!)).toBe("https://careers.acme.com/jobs");
    expect(careersUrl(companies[7]!)).toBe("https://acme.zohorecruit.eu/jobs/Careers");
    expect(careersUrl(companies[8]!)).toBe("https://acme.zohorecruit.com/jobs/Careers");
    expect(careersUrl(companies[9]!)).toBe("https://jobs.acme.com/search/");
    expect(careersUrl(companies[11]!)).toBe("https://chk.tbe.taleo.net/chk01/ats/careers/v2/jobSearch?org=ACME&cws=4");
    expect(careersUrl(companies[12]!)).toContain("https://phh.tbe.taleo.net/dispatcher/");
  });
});
