// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MyCompanies } from "../src/components/Companies";
import type { CompanyRow } from "../src/lib/setup";

afterEach(cleanup);

const row = (name: string, slug: string): CompanyRow => ({ id: slug, input: `greenhouse: ${slug}`, state: "saved", name, ats: "greenhouse", slug });
const rows = [row("Acme", "acme"), row("Globex", "globex")];
const renderList = (attention?: number) => render(<MyCompanies rows={rows} savedKeys={new Set()} onRemove={() => {}} onRemoveMany={() => {}} attention={attention} />);
const checked = () => screen.getByRole("radiogroup", { name: "Sort My companies" }).querySelector("[aria-checked=true]")?.textContent;

describe("MyCompanies sort", () => {
  it("starts on A–Z", () => {
    renderList();
    expect(checked()).toBe("A–Z");
  });

  it("starts on Needs attention when a failing link was followed", () => {
    renderList(1);
    expect(checked()).toBe("Needs attention");
  });

  it("switches to Needs attention each time a failing link is followed again", () => {
    const { rerender } = renderList();
    rerender(<MyCompanies rows={rows} savedKeys={new Set()} onRemove={() => {}} onRemoveMany={() => {}} attention={1} />);
    expect(checked()).toBe("Needs attention");
  });
});

describe("MyCompanies summary", () => {
  it("says how many companies there are and that each is checked on every scan", () => {
    renderList();
    expect(screen.getByText(/companies, checked on every scan\./).textContent).toBe("2 companies, checked on every scan.");
  });

  it("shows what the scan covers instead of a list when there are none", () => {
    render(<MyCompanies rows={[]} savedKeys={new Set()} onRemove={() => {}} onRemoveMany={() => {}} empty="Right now: 0 companies, so your Radar stays empty." />);
    expect(screen.getByText("Right now: 0 companies, so your Radar stays empty.")).toBeTruthy();
    expect(screen.queryByText(/checked on every scan/)).toBeNull();
  });
});

describe("MyCompanies rows", () => {
  it("has no job columns: For you and Open jobs live on the Radar", () => {
    renderList();
    expect(screen.queryByRole("columnheader", { name: "For you" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Open jobs" })).toBeNull();
    expect(screen.queryByText(/Hiring system/)).toBeNull();
  });

  it("links each name to its jobs on the Radar, under the names its jobs carry", () => {
    render(<MyCompanies rows={rows} savedKeys={new Set()} jobNames={new Map([["greenhouse:globex", ["Globex Corp"]]])} onRemove={() => {}} onRemoveMany={() => {}} />);
    const links = (name: string) => screen.getAllByRole("link", { name: `${name}: see its jobs on your Radar` }).map((a) => a.getAttribute("href"));
    expect(links("Acme")[0]).toBe("#radar?companies=Acme");
    expect(links("Globex")[0]).toBe("#radar?companies=Globex+Corp");
    expect(screen.getAllByTitle("See Acme on your Radar").length).toBeGreaterThan(0);
  });
});
