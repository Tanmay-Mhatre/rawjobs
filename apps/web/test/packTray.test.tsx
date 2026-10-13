// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ForYou } from "../src/components/companies/ForYou";
import { packActions, Tray, useVisit } from "../src/components/companies/Tray";
import { addCompanies, keyOf, type CompanyRef } from "../src/lib/companies";
import type { CompanySuggestion, CompanySuggestions } from "../src/lib/companySuggest";
import { emptyVisit, packState, recordAdd, recordRemove, uniqueMembers, undoLast } from "../src/lib/packVisit";
import type { CompanyRow } from "../src/lib/setup";

afterEach(cleanup);

const co = (name: string): CompanySuggestion => {
  const slug = name.toLowerCase();
  return {
    key: `greenhouse:${slug}`,
    name,
    ats: "greenhouse",
    slug,
    careers_url: `https://job-boards.greenhouse.io/${slug}`,
    open_jobs: 10,
    score: 50,
    matches: 0,
    new_matches: 0,
    near_misses: 0,
    elsewhere: 0,
    in_your_places: 0,
    examples: [],
    topics: [],
    industries: [],
    hires_for: [],
    reasons: [],
  };
};
// Stripe sits in both packs: 4 + 3 companies, 6 different ones.
const payments = { industry: "payments", items: ["Stripe", "Airwallex", "Tamara", "Thunes"].map(co) };
const crypto = { industry: "crypto", items: ["Kraken", "Coinbase", "Stripe"].map(co) };
const data: CompanySuggestions = {
  hiringNow: [],
  worthWatching: [],
  notScannable: [],
  scanned: 0,
  pastEmployers: [],
  lookalikes: [],
  packs: [payments, crypto],
  coverage: { in_industries: 0, trackable: 0 },
  index_generated_at: "",
};
const row = (name: string): CompanyRow => ({ id: name, input: `greenhouse: ${name.toLowerCase()}`, state: "saved", name, ats: "greenhouse", slug: name.toLowerCase() });

/** The Companies page's pack wiring (CompaniesTab), on a list held in memory. */
function Page({ initial = [] }: { initial?: CompanyRow[] }) {
  const [companies, setCompanies] = useState(initial);
  const watched = useMemo(() => new Set(companies.map(keyOf)), [companies]);
  const visit = useVisit();
  const addMany = (list: CompanyRef[]) => {
    const { patch, keys } = addCompanies({ companies, muted: [] }, list);
    if (patch?.companies) setCompanies(patch.companies);
    return keys;
  };
  const removeMany = (keys: readonly string[]) => setCompanies(companies.filter((r) => !keys.includes(keyOf(r))));
  const restore = (rows: readonly CompanyRow[]) => setCompanies((c) => [...c, ...rows]);
  const actions = packActions(visit, { companies, addMany, removeMany, restore });
  return (
    <>
      <ForYou
        state={{ kind: "ready", data }}
        watched={watched}
        muted={new Set()}
        pastEmployers={[]}
        onPastEmployers={() => {}}
        onAddMany={addMany}
        onRemoveMany={removeMany}
        onMute={() => {}}
        onUnmute={() => {}}
        industries={2}
        packActions={actions}
      />
      <Tray visit={visit.visit} actions={actions} />
      <p data-testid="said">{visit.said}</p>
      <span data-testid="count">{companies.length}</span>
    </>
  );
}

const pack = (name: RegExp) => screen.getByRole("region", { name });
const count = () => Number(screen.getByTestId("count").textContent);
const tray = () => screen.getByRole("region", { name: "Last change" });

describe("pack logic", () => {
  it("counts a company in two packs once", () => {
    expect(uniqueMembers([payments, crypto]).map((c) => c.name)).toEqual(["Stripe", "Airwallex", "Tamara", "Thunes", "Kraken", "Coinbase"]);
  });

  it("names the pack button from your companies alone", () => {
    const keys = (...names: string[]) => new Set(names.map((n) => `greenhouse:${n.toLowerCase()}`));
    expect(packState(payments.items, keys())).toMatchObject({ kind: "all", todo: 4, done: 0 });
    expect(packState(payments.items, keys("Stripe"))).toMatchObject({ kind: "more", todo: 3, done: 1 });
    expect(packState(payments.items, keys("Stripe", "Airwallex", "Tamara", "Thunes"))).toMatchObject({ kind: "done", todo: 0, done: 4 });
  });

  it("undoes the last change, a batch or one company", () => {
    const refs = payments.items.map((s) => ({ name: s.name, ats: s.ats, slug: s.slug, careers_url: s.careers_url }));
    let v = recordAdd(emptyVisit(), refs, refs.map(keyOf), "Added 4 from Payments", () => "payments");
    v = recordRemove(v, [row("Stripe")], "Removed Stripe");
    expect(v.last).toBe("Removed Stripe");
    const one = undoLast(v)!;
    expect(one.change.removed.map((r) => r.name)).toEqual(["Stripe"]);
    const batch = undoLast(one.visit)!;
    expect(batch.change.added).toHaveLength(4);
    expect(batch.visit.hist).toHaveLength(0);
    expect(undoLast(batch.visit)).toBeNull();
  });
});

describe("Starter packs", () => {
  it("offers Add all with each company counted once, then Add N more", () => {
    render(<Page />);
    expect(screen.getByRole("button", { name: "Add all 6" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kraken, add to My companies" }));
    expect(screen.getByRole("button", { name: "Add 5 more" })).toBeTruthy();
  });

  it("flips a chip in place, as a toggle", () => {
    render(<Page />);
    const chip = within(pack(/Payments/)).getByRole("button", { name: "Tamara, add to My companies" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    chip.focus();
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.getAttribute("aria-label")).toBe("Tamara, in My companies. Press to remove");
    expect(document.activeElement).toBe(chip);
    expect(screen.getByTestId("said").textContent?.trim()).toBe("Added Tamara.");
  });

  it("works the pack button out from your companies, so it survives a reload", () => {
    // A fresh visit with the whole Payments pack already in My companies (as after a reload).
    render(<Page initial={["Stripe", "Airwallex", "Tamara", "Thunes"].map(row)} />);
    const p = within(pack(/Payments/));
    expect(p.getByText("All added")).toBeTruthy();
    fireEvent.click(p.getByRole("button", { name: /Remove the .* pack/ }));
    expect(count()).toBe(0);
    expect(p.getByRole("button", { name: "Add all 4" })).toBeTruthy();
    expect(p.queryByText(/of 4 added/)).toBeNull();
    // Crypto had Stripe (shared) in it: progress only shows once a pack is started.
    expect(within(pack(/Crypto/)).queryByText(/\d+ of \d+ added/)).toBeNull();
  });

  it("shows Add N more and progress after some adds", () => {
    render(<Page initial={[row("Stripe")]} />);
    const p = within(pack(/Payments/));
    expect(p.getByRole("button", { name: "Add 3 more" })).toBeTruthy();
    expect(p.getByText("1 of 4 added")).toBeTruthy();
  });
});

describe("Tray", () => {
  it("stays hidden until something changes", () => {
    render(<Page />);
    expect(screen.queryByRole("region", { name: "Last change" })).toBeNull();
  });

  it("undoes one company, then a whole pack", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Kraken, add to My companies" }));
    const p = within(pack(/Payments/));
    const btn = p.getByRole("button", { name: "Add all 4" });
    btn.focus();
    fireEvent.click(btn);
    // The same button, still focused, now offers to remove the pack.
    expect(document.activeElement).toBe(btn);
    expect(btn.textContent).toBe("Remove pack");
    expect(count()).toBe(5);
    // Only the last change and Undo: the companies themselves are on the page.
    expect(tray().textContent).toBe("Added 4 from Payments Undo");
    expect(within(tray()).getAllByRole("button").length).toBe(1);

    fireEvent.click(within(tray()).getByRole("button", { name: /Undo/ }));
    expect(count()).toBe(1);
    expect(screen.getByTestId("said").textContent?.trim()).toBe("Undid: Added 4 from Payments.");
    expect(tray().textContent).toContain("Added Kraken");

    fireEvent.click(within(tray()).getByRole("button", { name: /Undo/ }));
    expect(count()).toBe(0);
    // Nothing left to undo, but the bar (and its focus) stays.
    expect(tray().textContent).toContain("Nothing left to undo");
    expect(within(tray()).getByRole("button", { name: /Undo/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("undoes a removal by putting the company back", () => {
    render(<Page initial={[row("Kraken")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Kraken, in My companies. Press to remove" }));
    expect(count()).toBe(0);
    fireEvent.click(within(tray()).getByRole("button", { name: /Undo/ }));
    expect(count()).toBe(1);
  });
});
