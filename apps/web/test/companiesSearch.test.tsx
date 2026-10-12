// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddByLink } from "../src/components/AddByLink";
import { MyCompanies } from "../src/components/Companies";
import { CompanyFinder, typedName, type DirCompany } from "../src/components/CompanyFinder";
import type { CompanyCheck, CompanyRow } from "../src/lib/setup";

vi.mock("../src/lib/setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/setup")>()),
  checkCompanies: vi.fn(
    async (urls: string[]): Promise<CompanyCheck[]> =>
      urls.map(
        (input) =>
          ({
            input,
            key: "ashby:revolut",
            ats: "ashby",
            slug: "revolut",
            name: "revolut",
            careers_url: "https://jobs.ashbyhq.com/revolut",
            status: "live",
            open_jobs: 12,
            in_directory: false,
            matches: 3,
            match_examples: ["Senior Product Manager, Payments"],
            sample_titles: ["Backend Engineer"],
          }) as CompanyCheck,
      ),
  ),
}));

beforeEach(() => {
  // The directory bar asks the local server for the directory's age; there is none here.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dir = (key: string, name: string): DirCompany => ({
  key,
  name,
  ats: key.split(":")[0]!,
  slug: key.split(":")[1]!,
  careers_url: `https://job-boards.greenhouse.io/${key.split(":")[1]}`,
  tier: "curated",
  status: "live",
  open_jobs: 10,
  indexed: true,
});

// The real directory's entries for these searches (data/catalog/directory.json).
const directory = [
  dir("greenhouse:revolutionmedicines", "Revolution Medicines"),
  dir("smartrecruiters:Carrevolutiscom", "Carrevolutis.com"),
  dir("greenhouse:emporiarevolutionizinghomeenergy", "Emporia Energy"),
  dir("ashby:recharge", "Getrecharge.Com"),
];

const browse = (q: string, onAddByLink = vi.fn()) => {
  render(<CompanyFinder watched={new Set()} directory={directory} directoryError={null} onAddMany={() => []} onRemove={() => {}} onDirectoryUpdated={() => {}} q={q} onAddByLink={onAddByLink} />);
  return { onAddByLink, text: () => document.body.textContent ?? "" };
};

describe("Browse all search", () => {
  it("“revolut”: says no company has that name, offers Add Revolut by link, and never matches a careers address", () => {
    const { onAddByLink, text } = browse("revolut");
    expect(screen.getByRole("heading", { name: "No company called “revolut” in the directory" })).toBeTruthy();
    expect(text()).toContain("No exact match for “revolut” · 2 close matches");
    expect(text()).toContain("Close matches");
    expect(text()).toContain("Revolution Medicines");
    expect(text()).toContain("name starts with “revolut”");
    expect(text()).toContain("name contains “revolut”");
    expect(text()).not.toContain("Emporia Energy");
    fireEvent.click(screen.getByRole("button", { name: "Add Revolut by link" }));
    expect(onAddByLink).toHaveBeenCalledWith("Revolut");
  });

  it("“recharge”: finds Recharge (listed as Getrecharge.Com) as the exact match, with no add-by-link prompt", () => {
    const { text } = browse("recharge");
    expect(text()).toContain("1 exact match for “recharge”");
    expect(text()).toContain("Recharge");
    expect(text()).not.toContain("No company called");
    expect(text()).not.toContain("Close matches");
  });

  it("no results at all: says so plainly and still offers Add by link", () => {
    const { onAddByLink, text } = browse("zyxwq");
    expect(screen.getByRole("heading", { name: "No company called “zyxwq” in the directory" })).toBeTruthy();
    expect(text()).toContain("No exact match for “zyxwq”");
    fireEvent.click(screen.getByRole("button", { name: "Add Zyxwq by link" }));
    expect(onAddByLink).toHaveBeenCalledWith("Zyxwq");
  });
});

describe("typedName", () => {
  it("title-cases a name typed in lower case and keeps one typed with capitals", () => {
    expect(typedName("  revolut ")).toBe("Revolut");
    expect(typedName("trade   republic")).toBe("Trade Republic");
    expect(typedName("eToro")).toBe("eToro");
  });
});

const row = (name: string, slug: string): CompanyRow => ({ id: slug, input: `greenhouse: ${slug}`, state: "saved", name, ats: "greenhouse", slug });
const mine = [row("Acme", "acme"), row("Globex", "globex"), row("Getrecharge.Com", "recharge")];
const list = (q: string) =>
  render(<MyCompanies rows={mine} savedKeys={new Set(mine.map((r) => `greenhouse:${r.slug}`))} onRemove={() => {}} onRemoveMany={() => {}} query={q} noMatch={<p>Nothing of yours</p>} />);
const listed = () => [...new Set(screen.queryAllByRole("link", { name: /see its jobs on your Radar/ }).map((a) => a.textContent))];

describe("My companies search", () => {
  it("filters your own companies in place, by raw or clean name", () => {
    list("glob");
    expect(listed()).toEqual(["Globex"]);
    cleanup();
    list("recharge");
    expect(listed()).toEqual(["Recharge"]);
  });

  it("lists everything with no search, and says when none of yours match", () => {
    list("");
    expect(listed()).toEqual(["Acme", "Globex", "Recharge"]);
    cleanup();
    list("revolut");
    expect(listed()).toEqual([]);
    expect(screen.getByText("Nothing of yours")).toBeTruthy();
  });
});

describe("Add by link", () => {
  it("names the link after the company searched for, and shows no roles", async () => {
    render(<AddByLink watched={new Set()} onAddMany={() => []} onRemove={() => {}} name="Revolut" />);
    fireEvent.change(screen.getByLabelText("Paste careers page links"), { target: { value: "https://jobs.ashbyhq.com/revolut" } });
    fireEvent.click(screen.getByRole("button", { name: /Scan links/ }));
    const name = (await screen.findByLabelText("Company name")) as HTMLInputElement;
    expect(name.value).toBe("Revolut");
    const text = document.body.textContent ?? "";
    expect(text).toContain("12 open jobs");
    for (const gone of ["roles match", "role matches", "Senior Product Manager", "Roles there now", "Backend Engineer"]) expect(text).not.toContain(gone);
  });
});
