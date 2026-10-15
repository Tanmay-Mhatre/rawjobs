import { describe, expect, it } from "vitest";
import { dealbreakers } from "../src/dealbreakers";
import { nationalsLabel, nationalsOnly } from "../src/posting";
import { scoreJob } from "../src/score";
import { profile } from "./helpers";

const job = (title: string, location = "Remote", description = "", workplace: "remote" | "onsite" | "unknown" = "remote") =>
  ({ title, location, workplace, description, salary: undefined }) as Parameters<typeof scoreJob>[0];

describe("a region in a remote job's title", () => {
  it("limits the job to that region, so it isn't one of your places", () => {
    const eu = scoreJob(job("Product Manager (EU only)"), profile());
    expect(eu.why.location).toBe(0);
    expect(eu.why.gate).toBe("location");
    expect(eu.why.locationNote).toMatch(/^Remote, but/);
    // The same job without the limit is remote anywhere: a place you take.
    expect(scoreJob(job("Product Manager"), profile()).why.location).toBe(15);
  });

  it("counts when the region is one you take, and never touches an on-site job", () => {
    expect(scoreJob(job("Product Manager (EMEA only)"), profile()).why.location).toBe(15);
    expect(scoreJob(job("Product Manager (EU only)", "Dubai", "", "onsite"), profile()).why.location).toBe(20);
  });
});

describe("nationalsOnly", () => {
  it("reads roles only a Gulf country's nationals can take", () => {
    expect(nationalsOnly("Relationship Manager - UAE National")).toBe("united arab emirates");
    expect(nationalsOnly("Product Manager", "This is an Emiratisation role.")).toBe("united arab emirates");
    expect(nationalsOnly("Product Manager", "The position is reserved for Saudi nationals.")).toBe("saudi arabia");
    expect(nationalsOnly("Product Manager", "Qatari nationals only.")).toBe("qatar");
    expect(nationalsOnly("Product Manager", "Emiratis only, please.")).toBe("united arab emirates");
    // A real posting's wording.
    expect(nationalsOnly("Senior Manager", "this opportunity is open exclusively to UAE Nationals (Emirati candidates) with a valid UAE family book.")).toBe("united arab emirates");
  });

  it("leaves wording that welcomes nationals, or names where you live, alone", () => {
    expect(nationalsOnly("Product Manager", "This role is open to UAE nationals and expats.")).toBeUndefined();
    expect(nationalsOnly("Product Manager", "Candidates based in the UAE only.")).toBeUndefined();
    expect(nationalsOnly("Product Manager")).toBeUndefined();
  });

  it("names the people the way postings do", () => {
    expect(nationalsLabel("united arab emirates")).toBe("UAE");
    expect(nationalsLabel("saudi arabia")).toBe("Saudi");
  });
});

describe("a nationals-only role as a dealbreaker", () => {
  const role = job("Relationship Manager - UAE National", "Dubai", "", "onsite");

  it("counts once you say where you're a citizen, and it's elsewhere", () => {
    expect(dealbreakers(role, profile({ citizenship: ["india"] }))).toContain("Only for UAE nationals");
  });

  it("doesn't count for its nationals, or when you haven't said", () => {
    expect(dealbreakers(role, profile({ citizenship: ["united arab emirates"] }))).toEqual([]);
    expect(dealbreakers(role, profile())).toEqual([]);
  });
});
