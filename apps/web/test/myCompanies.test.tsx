// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MyCompanies } from "../src/components/Companies";
import type { CompanyRow } from "../src/lib/setup";

afterEach(cleanup);

const row = (name: string, slug: string): CompanyRow => ({ id: slug, input: `greenhouse: ${slug}`, state: "saved", name, ats: "greenhouse", slug });
const rows = [row("Acme", "acme"), row("Globex", "globex")];
const renderList = (attention?: number) => render(<MyCompanies rows={rows} savedKeys={new Set()} forYou={new Map()} onRemove={() => {}} onRemoveMany={() => {}} attention={attention} />);
const checked = () => screen.getByRole("radiogroup", { name: "Sort My companies" }).querySelector("[aria-checked=true]")?.textContent;

describe("MyCompanies sort", () => {
  it("starts on Most jobs for you", () => {
    renderList();
    expect(checked()).toBe("Most jobs for you");
  });

  it("starts on Needs attention when a failing link was followed", () => {
    renderList(1);
    expect(checked()).toBe("Needs attention");
  });

  it("switches to Needs attention each time a failing link is followed again", () => {
    const { rerender } = renderList();
    rerender(<MyCompanies rows={rows} savedKeys={new Set()} forYou={new Map()} onRemove={() => {}} onRemoveMany={() => {}} attention={1} />);
    expect(checked()).toBe("Needs attention");
  });
});
