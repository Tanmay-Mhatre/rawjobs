import { describe, expect, it } from "vitest";
import { employmentType, employmentTypeOfTitle } from "../src/catalog/employment";
import { ashby } from "../src/connectors/ashby";
import { lever } from "../src/connectors/lever";
import { parsePersonio, personio } from "../src/connectors/personio";
import { toDashboardJob } from "../src/dashboard";
import type { CompanyRef, Job } from "../src/schema";

describe("employmentType (what the hiring system says)", () => {
  it("reads each system's spelling", () => {
    expect(employmentType("FullTime")).toBe("full-time");
    expect(employmentType("FULL_TIME")).toBe("full-time");
    expect(employmentType("Part-time")).toBe("part-time");
    expect(employmentType("Contractor")).toBe("contract");
    expect(employmentType("freelance")).toBe("contract");
    expect(employmentType("Intern")).toBe("internship");
    expect(employmentType("working_student")).toBe("internship");
    expect(employmentType("Temporary")).toBe("temporary");
    expect(employmentType("Permanent")).toBe("full-time");
    expect(employmentType("Vollzeit")).toBe("full-time");
    expect(employmentType("unbefristet")).toBe("full-time");
    expect(employmentType(["full time", "berufserfahren"])).toBe("full-time");
  });

  it("says nothing when unclear", () => {
    expect(employmentType(undefined)).toBeUndefined();
    expect(employmentType("")).toBeUndefined();
    expect(employmentType("Other")).toBeUndefined();
    expect(employmentType("International")).toBeUndefined();
    expect(employmentType("full-or-part-time")).toBeUndefined();
    expect(employmentType(["FULL_TIME", "PART_TIME"])).toBeUndefined();
    // Permanent and part-time: the narrower one.
    expect(employmentType(["permanent", "part-time"])).toBe("part-time");
  });
});

describe("employmentTypeOfTitle", () => {
  it("reads plain words in the title", () => {
    expect(employmentTypeOfTitle("Software Engineering Intern")).toBe("internship");
    expect(employmentTypeOfTitle("Werkstudent Marketing (m/w/d)")).toBe("internship");
    expect(employmentTypeOfTitle("Data Engineer (Contract)")).toBe("contract");
    expect(employmentTypeOfTitle("Backend Developer - Contract to hire")).toBe("contract");
    expect(employmentTypeOfTitle("Designer, 6-month contract")).toBe("contract");
    expect(employmentTypeOfTitle("Freelance Copywriter")).toBe("contract");
    expect(employmentTypeOfTitle("Barista - Part-time")).toBe("part-time");
    expect(employmentTypeOfTitle("Seasonal Warehouse Associate")).toBe("temporary");
    expect(employmentTypeOfTitle("Product Manager (Full-time)")).toBe("full-time");
  });

  it("never guesses from a role about the thing", () => {
    expect(employmentTypeOfTitle("Contract Manager")).toBeUndefined();
    expect(employmentTypeOfTitle("Senior Contracts Specialist")).toBeUndefined();
    expect(employmentTypeOfTitle("Intern Program Manager")).toBeUndefined();
    expect(employmentTypeOfTitle("Internal Auditor")).toBeUndefined();
    expect(employmentTypeOfTitle("International Sales Lead")).toBeUndefined();
    expect(employmentTypeOfTitle("Senior Product Manager")).toBeUndefined();
    expect(employmentTypeOfTitle("Nurse (Full-time or Part-time)")).toBeUndefined();
  });
});

describe("connectors keep the employment type", () => {
  const ref = (ats: CompanyRef["ats"]): CompanyRef => ({ name: "Acme", ats, slug: "acme", enabled: true });

  it("Lever's commitment, Ashby's employmentType, Personio's schedule", () => {
    const l = lever.normalize({ id: "1", text: "PM", hostedUrl: "https://x", categories: { commitment: "Full-time" } } as Parameters<typeof lever.normalize>[0], ref("lever"));
    expect(l.employmentType).toBe("full-time");
    const a = ashby.normalize({ id: "1", title: "PM", jobUrl: "https://x", employmentType: "Contract" } as Parameters<typeof ashby.normalize>[0], ref("ashby"));
    expect(a.employmentType).toBe("contract");
    const [p] = parsePersonio("<positions><position><id>1</id><name>PM</name><office>Berlin</office><employmentType>permanent</employmentType><schedule>part-time</schedule></position></positions>");
    expect(personio.normalize(p!, ref("personio")).employmentType).toBe("part-time");
  });

  it("the dashboard falls back to the title, and older saves without it load", () => {
    const job: Job = {
      id: "greenhouse:acme:1",
      ats: "greenhouse",
      company: "Acme",
      title: "Engineering Intern",
      location: "Berlin",
      workplace: "onsite",
      url: "https://x",
      firstSeen: "2026-10-01T00:00:00Z",
      lastSeen: "2026-10-01T00:00:00Z",
      status: "open",
      score: 50,
      why: { title: 30, location: 20, keywords: [], keywordPoints: 0, industry: 0 },
    };
    expect(toDashboardJob(job).employmentType).toBe("internship");
    expect(toDashboardJob({ ...job, employmentType: "contract" }).employmentType).toBe("contract");
    expect("employmentType" in toDashboardJob({ ...job, title: "Product Manager" })).toBe(false);
  });
});
