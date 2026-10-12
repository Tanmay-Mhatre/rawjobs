import { describe, expect, it } from "vitest";
import { expandPlaces, spellOutPlaces } from "../src/catalog/places";
import { gateOf, scoreJob } from "../src/score";
import { profile } from "./helpers";

const now = new Date("2026-10-03T12:00:00Z");
const job = (o: Partial<Parameters<typeof scoreJob>[0]> = {}) => ({
  title: "Senior Product Manager",
  location: "Dubai",
  workplace: "onsite" as const,
  description: "",
  postedAt: now.toISOString(),
  ...o,
});

describe("title gate reads titles the way people write them", () => {
  const gate = (title: string) => gateOf({ title, location: "Dubai", workplace: "onsite" }, profile());

  it.each(["Sr. PM", "Manager, Product", "Senior Manager, Product - Payments", "Product Managers", "Head of Product, Crypto", "PM II"])("passes %s", (title) => expect(gate(title)).toBeUndefined());

  it.each(["Production Manager", "Sr. Product Marketing Manager", "PMM", "APM", "Product Owner", "Project Manager"])("drops %s", (title) => expect(gate(title)).toBe("title"));

  it("counts short-form seniority", () => {
    expect(scoreJob(job({ title: "Sr. PM" }), profile()).why.title).toBe(30);
    // A plain title is one level below "senior": +5, not +10.
    expect(scoreJob(job({ title: "PM" }), profile()).why.title).toBe(25);
  });

  it("designers and UX/UI titles", () => {
    const design = profile({ titles: { include: ["product designer", "ux designer"], exclude: ["intern"] } });
    const g = (title: string) => gateOf({ title, location: "Dubai", workplace: "onsite" }, design);
    expect(g("Product Designers")).toBeUndefined();
    expect(g("UX/UI Designer")).toBeUndefined();
    expect(g("Designer, Product")).toBeUndefined();
    expect(g("UX Design Intern")).toBe("title");
  });
});

describe("topics from the title when there's no description", () => {
  it("a topic in the title counts, up to half the bar", () => {
    // payments (3) of top weight 5: 20 * 3/5 = 12, more than 40 * 3/12 = 10.
    expect(scoreJob(job({ title: "Senior Product Manager, Payments" }), profile()).why).toMatchObject({ keywords: ["payments"], keywordPoints: 12 });
    // Your top topic fills the title's half: 20.
    expect(scoreJob(job({ title: "Crypto PM" }), profile())).toMatchObject({ score: 25 + 20 + 20 + 10, why: { keywordPoints: 20 } });
    expect(scoreJob(job({ title: "Product Manager" }), profile()).why.keywordPoints).toBe(0);
  });

  it("short forms in the title count as the topic", () => {
    const ml = profile({ titles: { include: ["engineer"], exclude: [] }, keywords: { "machine learning": 4, python: 4, "distributed systems": 4 } });
    expect(scoreJob(job({ title: "Senior ML Engineer" }), ml).why).toMatchObject({ keywords: ["machine learning"], keywordPoints: 20 });
  });

  it("never puts a job without a description ahead of the same job with one", () => {
    for (const title of ["Senior Product Manager, Payments", "Crypto PM", "AI Product Manager", "Product Manager"])
      for (const description of ["", "We build things.", "Payments and KYC.", "crypto exchange stablecoin tokenization"]) {
        const bare = scoreJob(job({ title }), profile()).score;
        expect(scoreJob(job({ title, description }), profile()).score, `${title} / ${description}`).toBeGreaterThanOrEqual(bare);
      }
  });

  it("keeps the 0..100 bounds", () => {
    const one = profile({ keywords: { crypto: 1 } });
    expect(scoreJob(job({ title: "Senior Crypto PM", description: "crypto" }), one).score).toBe(100);
  });
});

describe("place aliases", () => {
  const places = (include: string[], remote_ok: string[] = [], remote_exclude: string[] = []) => profile({ locations: { include, remote_ok, remote_exclude } });
  const fit = (location: string, p: ReturnType<typeof places>, workplace: "onsite" | "remote" = "onsite") => scoreJob(job({ location, workplace }), p).why;

  it.each([
    [["san francisco"], "SF"],
    [["san francisco"], "San Francisco Bay Area"],
    [["sf"], "San Francisco, CA"],
    [["new york"], "NYC"],
    [["nyc"], "New York, NY"],
    [["bangalore"], "Bengaluru, Karnataka, India"],
    [["bengaluru"], "Bangalore"],
    [["mumbai"], "Bombay"],
    [["gurgaon"], "Gurugram, Haryana"],
    [["dubai"], "DXB"],
    [["abu dhabi"], "AUH, UAE"],
    [["saudi arabia"], "Riyadh, KSA"],
    [["los angeles"], "LA"],
    [["los angeles"], "Remote (LA)"],
    [["washington dc"], "Washington, DC"],
    [["united kingdom"], "Manchester, England"],
    [["uk"], "Edinburgh, Scotland"],
  ])("%j finds %s", (include, location) => expect(fit(location, places(include)).location).toBe(20));

  it("keeps the longest place name, and lower-case 'La' isn't Los Angeles", () => {
    expect(fit("Sydney, New South Wales", places(["united kingdom"])).gate).toBe("location");
    expect(fit("La Paz, Bolivia", places(["los angeles"])).gate).toBe("location");
  });

  it("reads 'remote - us', 'US remote' and 'remote (usa)' as the same place, for remote jobs only", () => {
    for (const term of ["remote - us", "us remote", "remote (usa)"]) {
      const p = places([], [term]);
      for (const where of ["US Remote", "Remote - US", "Remote (USA)", "Remote, United States"]) expect(fit(where, p, "remote").location, `${term}: ${where}`).toBe(15);
      expect(fit("Austin, US", p).gate).toBe("location");
      expect(fit("Remote - India", p, "remote").gate).toBe("location");
    }
  });

  it("expands names, leaving capitals-only ones to the location text", () => {
    expect(expandPlaces(["SF"])).toEqual(["sf", "san francisco", "san francisco bay area", "sf bay area", "bay area"]);
    expect(expandPlaces(["los angeles"])).toEqual(["los angeles"]);
    expect(expandPlaces(["uk"])).toContain("england");
    expect(spellOutPlaces("LA / SF")).toBe("los angeles / SF");
    expect(spellOutPlaces("Baton Rouge, LA")).toBe("Baton Rouge, LA");
  });
});
