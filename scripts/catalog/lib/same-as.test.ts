import { describe, expect, it } from "vitest";
import { sameAsLinks } from "./same-as";

const titles = (n: number, prefix = "Role") => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

describe("sameAsLinks", () => {
  it("joins same-name boards that list the same jobs (Doctolib on Ashby and Greenhouse)", () => {
    const links = sameAsLinks([
      { key: "ashby:doctolib", name: "Doctolib", open_jobs: 140, titles: titles(140) },
      { key: "greenhouse:doctolib", name: "Doctolib SAS", open_jobs: 142, titles: [...titles(140), "Extra 1", "Extra 2"] },
    ]);
    expect(links.get("ashby:doctolib")).toBe("greenhouse:doctolib");
    expect(links.get("greenhouse:doctolib")).toBe("greenhouse:doctolib");
  });

  it("small boards need 3 shared titles and half the smaller board; 5 shared is always enough", () => {
    const three = sameAsLinks([
      { key: "lever:miro", name: "Miro", titles: ["PM", "Designer", "Engineer", "Recruiter"] },
      { key: "greenhouse:miro", name: "Miro", titles: ["PM", "Designer", "Engineer", ...titles(40)] },
    ]);
    expect(three.size).toBe(2);
    const five = sameAsLinks([
      { key: "lever:big", name: "Big", titles: [...titles(5, "Shared"), ...titles(50, "A")] },
      { key: "ashby:big", name: "Big", titles: [...titles(5, "Shared"), ...titles(50, "B")] },
    ]);
    expect(five.size).toBe(2);
  });

  it("never joins on the name alone, or on a weak overlap (hive/range/harmony)", () => {
    expect(
      sameAsLinks([
        { key: "ashby:linear", name: "Linear", titles: ["Account Executive", "Product Engineer"] },
        { key: "cornerstone:linear", name: "Linear", titles: ["Nurse", "Account Executive"] },
      ]).size,
    ).toBe(0);
    expect(
      sameAsLinks([
        { key: "lever:hive", name: "Hive", titles: ["Sales Manager", ...titles(8, "Hive")] },
        { key: "greenhouse:hive", name: "Hive", titles: ["Sales Manager", ...titles(8, "Other")] },
      ]).size,
    ).toBe(0);
  });

  it("different names never join, even with the same titles (agtechnologies / satechnologies)", () => {
    expect(
      sameAsLinks([
        { key: "lever:agtechnologies", name: "AG Technologies", titles: titles(10) },
        { key: "greenhouse:satechnologiesinc4", name: "SA Technologies Inc", titles: titles(10) },
      ]).size,
    ).toBe(0);
  });
});
