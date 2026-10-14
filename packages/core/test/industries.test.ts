import { describe, expect, it } from "vitest";
import { companyIndustries, INDUSTRIES, INDUSTRY_GROUPS, industriesForLabel, industriesFromText, industriesFromTitles, industryCounts, industryEvidence } from "../src/catalog/industries";

describe("industry taxonomy", () => {
  it("has unique ids and resolvable `requires`", () => {
    const ids = INDUSTRIES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INDUSTRIES) if (i.requires) expect(ids).toContain(i.requires);
  });

  it("maps other lists' labels to ids, adding crypto for exchanges and custodians", () => {
    expect(industriesForLabel("crypto exchange")).toEqual(["crypto", "crypto-exchange"]);
    expect(industriesForLabel("Brokerage")).toEqual(["brokerage"]);
    expect(industriesForLabel("trading tech")).toEqual(["trading-tech"]);
    expect(industriesForLabel("digital bank")).toEqual(["digital-bank"]);
    expect(industriesForLabel("payments")).toEqual(["payments"]);
    expect(industriesForLabel("brokerage")).toEqual(industriesForLabel("brokerage"));
    expect(industriesForLabel("something else")).toEqual([]);
    expect(industriesForLabel(undefined)).toEqual([]);
  });
});

describe("industriesFromTitles", () => {
  const pad = (n: number) => Array.from({ length: n }, (_, i) => `Software Engineer ${i}`);

  it("tags a company when enough of its titles point to an industry", () => {
    const titles = ["Senior Product Manager, Forex", "CFD Dealer", "MT5 Platform Specialist", ...pad(20)];
    expect(industriesFromTitles(titles)).toContain("brokerage");
  });

  it("ignores one stray title at a big company", () => {
    expect(industriesFromTitles(["Payments Analyst", ...pad(60)])).not.toContain("payments");
  });

  it("only calls a company an exchange when it is a crypto company", () => {
    const exchange = ["Crypto Futures Product Manager", "P2P Operations", "Spot Trading Lead", "Crypto Listings Analyst", ...pad(10)];
    expect(industriesFromTitles(exchange)).toEqual(expect.arrayContaining(["crypto", "crypto-exchange"]));
    // Futures and derivatives at a commodities firm: not a crypto exchange.
    const commodities = ["Futures Trader", "Derivatives Analyst", "Futures Operations", ...pad(10)];
    expect(industriesFromTitles(commodities)).not.toContain("crypto-exchange");
    expect(industriesFromTitles(commodities, ["crypto"])).toContain("crypto-exchange");
  });
});

describe("industriesFromText", () => {
  it("finds industries a resume mentions at least twice", () => {
    const resume = "Led the MT5 migration for a CFD broker. Built forex onboarding. Crypto wallet launch; crypto custody partner. One payments project.";
    const found = industriesFromText(resume);
    expect(found[0]).toBe("brokerage");
    expect(found).toContain("crypto");
    expect(found).not.toContain("payments");
  });
});

describe("industryEvidence", () => {
  it("counts a phrase once, under its longest term", () => {
    const e = industryEvidence("Cross-border payments lead. Core banking migration. Cross-border payments again.", 1);
    expect(e.find((x) => x.id === "payments")).toEqual({ id: "payments", count: 2, terms: [["cross-border payments", 2]] });
    expect(e.find((x) => x.id === "banking")?.count).toBe(1);
  });

  it("reads mobility as an industry only from phrases that mean one", () => {
    expect(industriesFromText("Open to global mobility. Work authorization & mobility.")).not.toContain("mobility");
    expect(industriesFromText("PM for a shared mobility app; grew our urban mobility platform.")).toContain("mobility");
    // Job titles still count it: "Mobility Product Manager" tags a company as before.
    expect(industriesFromTitles(["Mobility Product Manager", "Mobility Ops Lead", "Engineer"])).toContain("mobility");
  });

  it("finds healthcare in a nurse's resume", () => {
    expect(industriesFromText("Registered Nurse, St. Mary's Hospital. Patient care on a 30-bed ward; nursing mentor.")[0]).toBe("healthtech");
  });
});

describe("the industry catalog", () => {
  it("puts every industry in a group, with a unique id and a way to tag companies", () => {
    const groups = new Set(INDUSTRY_GROUPS.map((g) => g.id));
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(INDUSTRIES.length);
    for (const i of INDUSTRIES) {
      expect(groups.has(i.group), i.id).toBe(true);
      expect(i.fromTitles || !!i.aliases?.length, i.id).toBe(true);
      expect(i.terms.length, i.id).toBeGreaterThan(0);
    }
    for (const g of INDUSTRY_GROUPS)
      expect(
        INDUSTRIES.some((i) => i.group === g.id),
        g.id,
      ).toBe(true);
  });

  it("covers industries beyond finance", () => {
    for (const id of ["saas", "biotech", "climate", "hardware", "consulting", "government", "retail", "manufacturing", "legal", "nonprofit"])
      expect(
        INDUSTRIES.some((i) => i.id === id),
        id,
      ).toBe(true);
  });
});

describe("resume matching ignores everyday words", () => {
  it("doesn't call a SaaS engineer crypto, gaming, insurance or logistics", () => {
    const resume = `Senior engineer at a B2B SaaS company. Built JWT token auth and an API token service; shipped an AI
      assistant and an SDK. Game-changing launch. Processed claims data, property listings and fleet dashboards.
      Moved our SaaS billing to usage-based pricing. Mentored students.`;
    const found = industriesFromText(resume);
    expect(found).toContain("saas");
    for (const id of ["crypto", "crypto-exchange", "gaming", "insurtech", "proptech", "logistics", "ai", "devtools", "edtech"]) expect(found, id).not.toContain(id);
  });

  it("still tags companies from the same words in job titles", () => {
    const pad = (n: number) => Array.from({ length: n }, (_, i) => `Software Engineer ${i}`);
    expect(industriesFromTitles(["Claims Adjuster", "Senior Claims Specialist", ...pad(10)])).toContain("insurtech");
    expect(industriesFromTitles(["Game Designer", "Senior Game Producer", ...pad(10)])).toContain("gaming");
  });
});

describe("industryCounts", () => {
  it("counts list and title tags once per company, listing every industry", () => {
    const counts = industryCounts([{ tags: ["crypto"], title_tags: ["crypto", "ai"] }, { title_tags: ["ai"] }, {}]);
    expect(counts.crypto).toBe(1);
    expect(counts.ai).toBe(2);
    expect(counts.biotech).toBe(0);
    expect(companyIndustries({ tags: ["crypto"], title_tags: ["crypto", "ai"] })).toEqual(["crypto", "ai"]);
  });
});

describe("seniorityOf", async () => {
  const { seniorityOf } = await import("../src/catalog/seniority");
  it.each([
    ["Head of Product, Payments", "leadership"],
    ["VP Product", "leadership"],
    ["Principal Product Manager", "principal"],
    ["Group Product Manager", "principal"],
    ["Lead Product Manager - Wallet", "principal"],
    ["Sr. Product Manager", "senior"],
    ["Senior Product Manager", "senior"],
    ["Product Manager", "mid"],
    ["Associate Product Manager", "entry"],
  ] as const)("%s -> %s", (title, level) => expect(seniorityOf(title)).toBe(level));
});

describe("countriesIn", async () => {
  const { countriesIn } = await import("../src/catalog/places");
  it.each([
    ["Dubai, UAE", undefined, ["United Arab Emirates"]],
    ["San Jose, CA", undefined, ["United States"]],
    ["Remote - USA (US - Remote Zone 1)", undefined, ["United States"]],
    ["London", "GB", ["United Kingdom"]],
    ["", "AE", ["United Arab Emirates"]],
    ["Sydney, New South Wales", undefined, ["Australia"]],
    ["New York, NY; London, England", undefined, ["United States", "United Kingdom"]],
    ["Remote", undefined, []],
    ["Dubai; London, UK", undefined, ["United Arab Emirates", "United Kingdom"]],
    ["London, Ontario", undefined, ["Canada"]],
  ] as const)("%s (%s)", (location, country, expected) => expect(countriesIn(location, country).sort()).toEqual([...expected].sort()));
});

describe("citiesIn", async () => {
  const { citiesIn } = await import("../src/catalog/places");
  it.each([
    ["Dubai, UAE", ["Dubai, United Arab Emirates"]],
    ["USA - New York, NY", ["New York, United States"]],
    ["New York City Office; San Francisco HQ", ["New York, United States", "San Francisco, United States"]],
    ["US-CA-Menlo Park", ["Menlo Park, United States"]],
    ["US California (Redwood City)", ["Redwood City, United States"]],
    ["Washington, D.C.", ["Washington DC, United States"]],
    ["Santa Clara, California, United States", ["Santa Clara, United States"]],
    ["Amsterdam, The Netherlands", ["Amsterdam, Netherlands"]],
    ["Bengaluru, India", ["Bangalore, India"]],
    ["Dubai; London, UK", ["Dubai, United Arab Emirates", "London, United Kingdom"]],
    ["United States", []],
    ["Remote - Canada", []],
    ["Remote Roles - EMEA", []],
    ["Middle East & North Africa", []],
    ["Remote", []],
  ] as const)("%s", (location, expected) => expect(citiesIn(location)).toEqual([...expected]));

  it("reads words that are also built-in object names as words", () => {
    // A job title piece once crashed groupKey: "constructor" found Object.prototype.constructor.
    expect(() => citiesIn("Constructor")).not.toThrow();
    expect(() => citiesIn("toString, hasOwnProperty")).not.toThrow();
  });
});
