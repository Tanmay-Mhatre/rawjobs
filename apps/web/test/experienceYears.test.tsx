// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDraft, type Draft } from "../src/lib/setup";
import { buildSuggestions, prefillDraft, type Suggestions } from "../src/lib/suggest";
import { RolesStep } from "../src/setup/RolesStep";

afterEach(cleanup);

const RESUME = `# Jane Doe
## Experience
### Senior PM, Acme Exchange (Jan 2016 – Dec 2020)
- Launched stablecoin payouts.
### Advisor, PayCo (Jun 2019 – Dec 2022)
- Card issuing for 30k merchants.
## Education
### BSc, State University (2008 – 2012)`;

function Harness({ start, suggest, onDraft = () => {} }: { start: Draft; suggest?: Suggestions; onDraft?: (d: Draft) => void }) {
  const [draft, setDraft] = useState(start);
  return (
    <RolesStep
      draft={draft}
      suggest={suggest}
      update={(patch) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        onDraft(next);
      }}
    />
  );
}

describe("Years of experience from the resume", () => {
  it("suggests the merged total but never prefills it", () => {
    const s = buildSuggestions(RESUME);
    expect(s.experience).toEqual({ years: 7, roles: 2 });
    expect(prefillDraft(emptyDraft(), s)).not.toHaveProperty("experienceYears");
  });

  it("fills the field only when you click Use", () => {
    let latest: Draft | undefined;
    render(<Harness start={emptyDraft()} suggest={buildSuggestions(RESUME)} onDraft={(d) => (latest = d)} />);
    expect(screen.getByText("7 years from resume?")).toBeTruthy();
    expect(screen.getByText(/about 7 years across 2 roles, gaps left out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use 7", hidden: true }));
    expect(latest?.experienceYears).toBe(7);
    expect((screen.getByLabelText("Years of experience") as HTMLInputElement).value).toBe("7");
    // Once it matches, the suggestion goes away.
    expect(screen.queryByRole("button", { name: "Use 7", hidden: true })).toBeNull();
  });

  it("keeps a number you typed and still offers the resume's", () => {
    render(<Harness start={{ ...emptyDraft(), experienceYears: 4 }} suggest={buildSuggestions(RESUME)} />);
    expect(screen.getByText("4 years")).toBeTruthy();
    expect((screen.getByLabelText("Years of experience") as HTMLInputElement).value).toBe("4");
    expect(screen.getByRole("button", { name: "Use 7", hidden: true })).toBeTruthy();
  });
});
