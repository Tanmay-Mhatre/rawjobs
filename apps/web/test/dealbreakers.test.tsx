// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DealbreakersStep, parseList } from "../src/components/Dealbreakers";
import { draftFromConfig, draftToConfig, emptyDraft, saveBlockers, type Draft } from "../src/lib/setup";

afterEach(cleanup);

const base: Draft = { ...emptyDraft(), include: ["platform engineer"], places: ["berlin"] };

/** The form with a live draft, as Settings holds it. */
function Harness({ start, onDraft }: { start: Draft; onDraft: (d: Draft) => void }) {
  const [draft, setDraft] = useState(start);
  return (
    <DealbreakersStep
      draft={draft}
      update={(patch) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        onDraft(next);
      }}
    />
  );
}

describe("Settings > Dealbreakers", () => {
  it("fills the salary floor, countries and avoided work into the draft", () => {
    let draft = base;
    render(<Harness start={base} onDraft={(d) => (draft = d)} />);
    fireEvent.change(screen.getByLabelText("Salary floor"), { target: { value: "85,000" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "eur" } });
    fireEvent.click(screen.getByRole("radio", { name: "A month" }));
    fireEvent.change(screen.getByLabelText("Countries you can work in without a visa sponsor"), { target: { value: "United Kingdom, eu," } });
    fireEvent.change(screen.getByLabelText("Work you won't do"), { target: { value: "Frontend, credit risk" } });
    expect(draft.salaryFloor).toEqual({ amount: 85000, currency: "EUR", period: "month" });
    expect(draft.workAuthorization).toEqual(["united kingdom", "eu"]);
    expect(draft.avoid).toEqual(["frontend", "credit risk"]);
    // What you typed stays as typed, trailing comma and all.
    expect((screen.getByLabelText("Countries you can work in without a visa sponsor") as HTMLInputElement).value).toBe("United Kingdom, eu,");
  });

  it("has help text for each field and no uppercase classes", () => {
    const { container } = render(<Harness start={base} onDraft={() => {}} />);
    expect(container.textContent).toContain('Write "none" if you need sponsorship everywhere');
    expect(container.textContent).toContain("not a passing mention");
    expect(container.querySelector('[class*="uppercase"]')).toBeNull();
  });

  it("saves only what's set, and round-trips through the config", () => {
    expect(draftToConfig(base).profile).not.toHaveProperty("salary_floor");
    expect(draftToConfig(base).profile).not.toHaveProperty("avoid");
    const set: Draft = { ...base, salaryFloor: { amount: 6500, currency: "sgd", period: "month" }, workAuthorization: ["singapore"], avoid: ["audit"] };
    const cfg = draftToConfig(set);
    expect(cfg.profile).toMatchObject({ salary_floor: { amount: 6500, currency: "SGD", period: "month" }, work_authorization: ["singapore"], avoid: ["audit"] });
    expect(draftFromConfig(cfg)).toMatchObject({ salaryFloor: { amount: 6500, currency: "SGD", period: "month" }, workAuthorization: ["singapore"], avoid: ["audit"] });
  });

  it("blocks saving a floor without a usable currency", () => {
    expect(saveBlockers({ ...base, salaryFloor: { amount: 85000, currency: "", period: "year" } }).map((b) => b.message)).toContain("Add the salary floor's currency as 3 letters, such as EUR.");
    expect(saveBlockers({ ...base, salaryFloor: { amount: 85000, currency: "EUR", period: "year" } })).toEqual([]);
  });

  it("parses comma lists", () => {
    expect(parseList(" Frontend,, credit risk ; frontend\nAP ")).toEqual(["frontend", "credit risk", "ap"]);
  });
});
