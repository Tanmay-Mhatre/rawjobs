// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDraft, type Draft } from "../src/lib/setup";
import { buildSuggestions, prefillDraft, type Suggestions } from "../src/lib/suggest";
import { IndustriesStep } from "../src/setup/steps";

afterEach(cleanup);

const CRYPTO_PM = `# Jane Doe
## Summary
Product Manager in payments and crypto. Built stablecoin payments, crypto custody and cross-border payments.
## Experience
### Senior PM, Acme Exchange (2022 – Present)
- Launched stablecoin payouts; crypto onboarding with KYC.
### PM, PayCo (2018 – 2021)
- Card issuing and payments for 30k merchants.
## Work authorization & mobility
UAE resident, open to global mobility.`;

const TEMPLATE = `# MASTER RESUME — [Your Name]
## EXPERIENCE
### [Company] — [Title]
## WORK AUTHORIZATION & MOBILITY`;

function Harness({ start, suggest, onDraft = () => {} }: { start: Draft; suggest?: Suggestions; onDraft?: (d: Draft) => void }) {
  const [draft, setDraft] = useState(start);
  return (
    <IndustriesStep
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

/** Every group heading and chip, in page order. */
const layout = () =>
  screen.getAllByRole("group").map((g) => [
    g.getAttribute("aria-label"),
    within(g)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ]);

describe("Industries step", () => {
  it("never moves anything when you pick, and keeps focus on the chip", () => {
    render(<Harness start={emptyDraft()} suggest={buildSuggestions(CRYPTO_PM)} />);
    const before = layout().map(([g, chips]) => [g, (chips as string[]).length]);
    const banking = within(screen.getByRole("group", { name: "Financial services" })).getByRole("button", { name: /Banking/ });
    banking.focus();
    fireEvent.click(banking);
    fireEvent.click(within(screen.getByRole("group", { name: "Health & life sciences" })).getByRole("button", { name: /Biotech/ }));
    expect(layout().map(([g, chips]) => [g, (chips as string[]).length])).toEqual(before);
    expect(
      screen
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label"))
        .slice(1, 3),
    ).toEqual(["Software & internet", "Financial services"]);
    expect(within(screen.getByRole("group", { name: "Financial services" })).getAllByRole("button")[0]!.textContent).toContain("Fintech");
    expect(document.activeElement).toBe(banking);
  });

  it("shows every group, with no 'Show all industries'", () => {
    render(<Harness start={emptyDraft()} />);
    expect(screen.getAllByRole("group")).toHaveLength(7);
    expect(screen.queryByText(/Show all industries/)).toBeNull();
  });

  it("doesn't put transport first because of a 'mobility' topic", () => {
    render(<Harness start={{ ...emptyDraft(), keywords: { mobility: 3 } }} />);
    expect(screen.getAllByRole("group")[0]!.getAttribute("aria-label")).toBe("Software & internet");
  });

  it("suggests from the resume with its evidence, and names the picks", () => {
    let draft = emptyDraft();
    render(<Harness start={emptyDraft()} suggest={buildSuggestions(CRYPTO_PM)} onDraft={(d) => (draft = d)} />);
    const card = screen.getByRole("group", { name: "Suggested industries" });
    expect(
      within(card)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining(["Payments", "Crypto & Web3"]));
    expect(screen.getByText(/Your resume mentions payments ×\d/)).toBeTruthy();
    expect(within(card).queryByText(/Mobility/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Payments" }));
    expect(draft.industries).toEqual(["payments"]);
    expect(screen.getByRole("status").textContent).toBe("Added Payments. 1 picked.");
    expect(screen.getByText(/1 picked: Payments\./)).toBeTruthy();
  });

  it("says when the resume is an empty template, and suggests nothing", () => {
    render(<Harness start={emptyDraft()} suggest={buildSuggestions(TEMPLATE)} />);
    expect(screen.getByText(/looks like an empty template/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Suggested industries" })).toBeNull();
  });

  it("falls back to the roles when there's no resume", () => {
    render(<Harness start={{ ...emptyDraft(), include: ["registered nurse", "nurse practitioner", "clinical nurse"] }} />);
    expect(screen.getByText("Suggested from your roles")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Suggested industries" })).getByRole("button", { name: /Healthcare/ })).toBeTruthy();
  });
});

describe("prefilling industries from a resume", () => {
  it("pre-selects only industries the resume keeps naming, at most 3", () => {
    const s = buildSuggestions(CRYPTO_PM);
    const patch = prefillDraft(emptyDraft(), s);
    expect(patch.industries?.length).toBeLessThanOrEqual(3);
    expect(patch.industries).toEqual(expect.arrayContaining(["payments", "crypto"]));
    for (const id of patch.industries!) expect(s.industryCounts[id]).toBeGreaterThanOrEqual(3);
  });

  it("fills nothing from an empty template", () => {
    const s = buildSuggestions(TEMPLATE);
    expect(s.template).toEqual(["[Your Name]", "[Company]", "[Title]"]);
    expect(prefillDraft(emptyDraft(), s)).toEqual({});
  });

  it("keeps up to 4 industries from an AI profile", () => {
    const ai = {
      target_titles: [],
      seniority: [],
      exclude_titles: [],
      locations: [],
      open_to_remote: false,
      remote_regions: [],
      keywords: {},
      industries: ["crypto", "payments", "fintech", "banking", "wealth"],
      past_employers: [],
    };
    expect(prefillDraft(emptyDraft(), buildSuggestions(TEMPLATE, ai)).industries).toEqual(["crypto", "payments", "fintech", "banking"]);
  });
});
