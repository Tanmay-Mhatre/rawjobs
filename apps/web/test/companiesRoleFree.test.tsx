// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SuggestionCard } from "../src/components/companies/SuggestionCard";
import { industryOf, searchDirectory, type DirCompany } from "../src/components/CompanyFinder";
import { companyReasons, type CompanySuggestion } from "../src/lib/companySuggest";
import { fromQuery, radarCompanyHash } from "../src/lib/filters";

afterEach(cleanup);

// Companies is about companies: role counts, example roles and fit labels live on the Radar.

describe("companyReasons", () => {
  it("drops the reasons that count roles and keeps the ones about the company", () => {
    expect(
      companyReasons([
        "Your industry: Payments",
        "3 open roles match you",
        "1 open role matches you",
        "2 new this week",
        "4 similar roles nearby or remote",
        "Hiring in Dubai (other roles)",
        "Your topics: payments, crypto",
      ]),
    ).toEqual(["Your industry: Payments", "Hiring in Dubai (other roles)", "Your topics: payments, crypto"]);
  });
});

const suggestion = (patch: Partial<CompanySuggestion> = {}): CompanySuggestion => ({
  key: "greenhouse:kraken",
  name: "Kraken",
  ats: "greenhouse",
  slug: "kraken",
  careers_url: "https://job-boards.greenhouse.io/kraken",
  open_jobs: 82,
  score: 63,
  matches: 4,
  new_matches: 1,
  near_misses: 0,
  elsewhere: 0,
  in_your_places: 0,
  examples: ["Senior Product Manager (Remote)"],
  topics: [],
  industries: ["crypto"],
  hires_for: [],
  reasons: ["Your industry: Crypto & Web3", "4 open roles match you", "1 new this week"],
  ...patch,
});

describe("SuggestionCard", () => {
  it("shows the company and where it hires, with no roles, fit label, job counts or hiring system", () => {
    const { container } = render(<SuggestionCard s={suggestion({ hires_in: { remote: true, countries: ["United Arab Emirates"] } })} added={false} onAdd={() => {}} onRemove={() => {}} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Kraken");
    expect(text).toContain("Hires in UAE, remote");
    // Why it's suggested sits once over its group, not on each card.
    expect(text).not.toContain("Your industry");
    for (const gone of ["roles match", "new this week", "Senior Product Manager", "fit", "open jobs", "Hiring system", "Greenhouse", "Why?"]) expect(text).not.toContain(gone);
  });
});

const dir = (key: string, name: string, patch: Partial<DirCompany> = {}): DirCompany => ({
  key,
  name,
  ats: key.split(":")[0]!,
  slug: key.split(":")[1]!,
  careers_url: `https://example.com/${name}`,
  tier: "curated",
  status: "live",
  open_jobs: 10,
  indexed: true,
  ...patch,
});

describe("Browse all", () => {
  it("orders by fit, then size, never by jobs for you", () => {
    const all = [dir("greenhouse:a", "Alpha", { open_jobs: 500 }), dir("greenhouse:b", "Beta", { open_jobs: 5 })];
    const names = (fit: Map<string, number>) => searchDirectory(all, { q: "", watched: new Set(), fit }).map((g) => g.lead.name);
    expect(names(new Map())).toEqual(["Alpha", "Beta"]);
    expect(names(new Map([["greenhouse:b", 80]]))).toEqual(["Beta", "Alpha"]);
  });

  it("names a company's industry, one of yours first", () => {
    const c = { tags: ["saas", "ai"] };
    expect(industryOf(c)).toBe(industryOf({ tags: ["saas"] }));
    expect(industryOf(c, ["ai"])).toBe(industryOf({ tags: ["ai"] }));
    expect(industryOf(c, ["ai"])).not.toBe(industryOf(c));
    expect(industryOf({ tags: ["not-an-industry"] })).toBeUndefined();
  });
});

describe("radarCompanyHash", () => {
  it("opens the Radar on a company's jobs, under every name they carry", () => {
    const hash = radarCompanyHash(["Kraken", "Kraken Digital", "Kraken"]);
    expect(hash.startsWith("#radar?")).toBe(true);
    expect(fromQuery(hash.split("?")[1]!)?.filters.companies).toEqual(["Kraken", "Kraken Digital"]);
  });

  it("survives names with spaces and symbols", () => {
    expect(fromQuery(radarCompanyHash(["AT&T Labs"]).split("?")[1]!)?.filters.companies).toEqual(["AT&T Labs"]);
  });
});
