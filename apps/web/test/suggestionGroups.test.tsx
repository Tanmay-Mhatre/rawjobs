// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForYou } from "../src/components/companies/ForYou";
import { packActions, Tray, useVisit } from "../src/components/companies/Tray";
import { addCompanies, keyOf, type CompanyRef } from "../src/lib/companies";
import { type CompanySuggestion, type CompanySuggestions, groupSuggestions, whereTheyHire } from "../src/lib/companySuggest";
import { clearFresh, packMembers, revealNext } from "../src/lib/packVisit";
import type { CompanyRow } from "../src/lib/setup";

afterEach(cleanup);

const co = (name: string, patch: Partial<CompanySuggestion> = {}): CompanySuggestion => {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return {
    key: `greenhouse:${slug}`,
    name,
    ats: "greenhouse",
    slug,
    careers_url: `https://job-boards.greenhouse.io/${slug}`,
    open_jobs: 10,
    score: 50,
    matches: 1,
    new_matches: 0,
    near_misses: 0,
    elsewhere: 0,
    in_your_places: 0,
    examples: [],
    topics: [],
    industries: [],
    hires_for: [],
    reasons: [],
    ...patch,
  };
};

describe("whereTheyHire", () => {
  it("says where, in short country names, and remote", () => {
    expect(whereTheyHire({ remote: true, countries: [] })).toBe("Hires remote");
    expect(whereTheyHire({ remote: false, countries: ["United Arab Emirates"] })).toBe("Hires in UAE");
    expect(whereTheyHire({ remote: true, countries: ["United Arab Emirates", "United Kingdom", "Malta"] })).toBe("Hires in UAE, UK, remote");
    expect(whereTheyHire({ remote: false, countries: [] })).toBeNull();
    expect(whereTheyHire(undefined)).toBeNull();
  });
});

describe("groupSuggestions", () => {
  it("puts the shared reason once per group, in the order of each group's best card", () => {
    const groups = groupSuggestions(
      [
        co("Trust Wallet", { industries: ["crypto"], topics: ["crypto", "web3"] }),
        co("BVNK", { industries: ["payments"] }),
        co("0x", { industries: ["crypto"], topics: ["crypto", "web3", "defi"] }),
        co("Nebius", { hires_for: ["ai"] }),
        co("Etihad"),
      ],
      "hiring",
    );
    expect(groups.map((g) => [g.title, g.items.map((s) => s.name)])).toEqual([
      ["Crypto & Web3", ["Trust Wallet", "0x"]],
      ["Payments", ["BVNK"]],
      ["AI & machine learning", ["Nebius"]],
      ["Other companies", ["Etihad"]],
    ]);
    expect(groups[0]!.reason).toBe("Your industry, and your topics crypto and web3");
    expect(groups[1]!.reason).toBe("Your industry");
    expect(groups.map((g) => g.inside)).toEqual([true, true, false, false]);
    expect(groups[3]!.reason).toBe("Open roles that pass your title and place filters");
  });

  it("words the catch-all group in Not hiring yet by what its companies share", () => {
    expect(groupSuggestions([co("A", { matches: 0, elsewhere: 2 }), co("B", { matches: 0, elsewhere: 1 })], "watching")[0]!.reason).toBe("Your roles, in other places");
    expect(groupSuggestions([co("A", { matches: 0, near_misses: 1 }), co("B", { matches: 0, elsewhere: 1 })], "watching")[0]!.reason).toBe("Your roles, places or topics");
  });
});

describe("next in this pack", () => {
  const pack = { industry: "crypto", items: [co("Kraken"), co("Coinbase")], more: [co("Ledger"), co("Sei Labs"), co("Coinflow"), co("Meshpay")] };

  it("reveals the next 2 extras you don't have, at the end, marked new until the next change", () => {
    let s = revealNext({}, pack, "Kraken", new Set([keyOf(co("Sei Labs"))]));
    expect(packMembers(pack, s).map((c) => c.name)).toEqual(["Kraken", "Coinbase", "Ledger", "Coinflow"]);
    expect(s.crypto).toMatchObject({ after: "Kraken", fresh: [co("Ledger").key, co("Coinflow").key] });
    s = revealNext(s, pack, "Coinbase", new Set());
    expect(packMembers(pack, s).map((c) => c.name)).toEqual(["Kraken", "Coinbase", "Ledger", "Coinflow", "Sei Labs", "Meshpay"]);
    // Out of extras: the shown ones stay, nothing is new.
    s = revealNext(s, pack, "Ledger", new Set());
    expect(packMembers(pack, s)).toHaveLength(6);
    expect(s.crypto!.fresh).toEqual([]);
    expect(clearFresh({ crypto: { keys: ["x"], after: "K", fresh: ["x"] } }).crypto!.fresh).toEqual([]);
  });
});

const data = (patch: Partial<CompanySuggestions> = {}): CompanySuggestions => ({
  hiringNow: [],
  worthWatching: [],
  notScannable: [],
  scanned: 0,
  pastEmployers: [],
  lookalikes: [],
  packs: [],
  coverage: { in_industries: 0, trackable: 0 },
  index_generated_at: "2026-10-07T09:55:42.522Z",
  ...patch,
});

/** The Companies page's wiring (CompaniesTab), on a list held in memory. */
function Page({ d, pastEmployers = [], onShowHidden }: { d: CompanySuggestions; pastEmployers?: string[]; onShowHidden?: () => void }) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [past, setPast] = useState(pastEmployers);
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
        state={{ kind: "ready", data: d }}
        watched={watched}
        muted={new Set(muted)}
        pastEmployers={past}
        onPastEmployers={setPast}
        onAddMany={addMany}
        onRemoveMany={removeMany}
        onMute={(k) => setMuted((m) => [...m, k])}
        onUnmute={(k) => setMuted((m) => m.filter((x) => x !== k))}
        onShowHidden={onShowHidden}
        industries={2}
        packActions={actions}
      />
      <Tray visit={visit.visit} watched={watched} actions={actions} />
      <span data-testid="count">{companies.length}</span>
    </>
  );
}

const count = () => Number(screen.getByTestId("count").textContent);

describe("Starter packs: next in this pack", () => {
  const crypto = { industry: "crypto", items: ["Kraken", "Coinbase", "Bybit"].map((n) => co(n)), more: ["Ledger", "Sei Labs", "Coinflow"].map((n) => co(n)) };

  it("adds the next 2 of a pack at its end after one pick, and they join the pack in the tray", () => {
    render(<Page d={data({ packs: [crypto] })} />);
    const p = () => within(screen.getByRole("region", { name: /Crypto/ }));
    expect(p().queryByRole("button", { name: /Ledger/ })).toBeNull();
    fireEvent.click(p().getByRole("button", { name: "Coinbase, add to My companies" }));
    const chips = p()
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((l) => l?.includes("My companies"));
    expect(chips).toEqual([
      "Kraken, add to My companies",
      "Coinbase, in My companies. Press to remove",
      "Bybit, add to My companies",
      "Ledger, add to My companies. New in this pack",
      "Sei Labs, add to My companies. New in this pack",
    ]);
    expect(p().getByText("Next in this pack, after Coinbase")).toBeTruthy();
    // The pack button counts the extras too; picking one drops the "new" marks and shows the last extra.
    expect(p().getByRole("button", { name: "Add 4 more" })).toBeTruthy();
    fireEvent.click(p().getByRole("button", { name: "Ledger, add to My companies. New in this pack" }));
    expect(p().getByRole("button", { name: "Sei Labs, add to My companies" })).toBeTruthy();
    expect(p().getByRole("button", { name: "Coinflow, add to My companies. New in this pack" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Added this visit" })).getByRole("button", { name: "Review" }));
    expect(screen.getByRole("region", { name: "Added this visit" }).textContent).toContain("Crypto & Web3 2");
  });
});

describe("Hiring for you now", () => {
  const inside = Array.from({ length: 12 }, (_, i) => co(`Crypto ${i + 1}`, { industries: ["crypto"], topics: ["crypto"], hires_in: { remote: true, countries: [] } }));
  const d = data({ hiringNow: [...inside, co("Etihad", { hires_in: { remote: false, countries: ["United Arab Emirates"] } })] });

  it("puts the reason once over its group, and on each card only where it hires", () => {
    render(<Page d={d} />);
    fireEvent.click(screen.getByRole("tab", { name: /Hiring for you now/ }));
    expect(screen.getByText(/^In your industries, as of /)).toBeTruthy();
    const group = screen.getByRole("region", { name: /Crypto & Web3/ });
    expect(group.textContent).toContain("Your industry, and your topic crypto");
    expect(within(group).getAllByText("Hires remote").length).toBe(9);
    expect(within(group).queryByText(/Your industry:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show 3 more in your industries" })).toBeTruthy();
    // Outside your industries is folded and left out of Add top 10.
    expect(screen.getByText("Outside your industries").closest("details")!.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Add top 10/ }));
    expect(count()).toBe(10);
    expect(screen.getByText("Added 10")).toBeTruthy();
  });

  it("hides a company with Undo", () => {
    render(<Page d={d} />);
    fireEvent.click(screen.getByRole("tab", { name: /Hiring for you now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Crypto 1" }));
    expect(screen.queryByRole("button", { name: "Hide Crypto 1" })).toBeNull();
    expect(screen.getByText(/It won't be suggested/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(screen.getByRole("button", { name: "Hide Crypto 1" })).toBeTruthy();
  });

  it("links from the hide note to your hidden companies", () => {
    const onShowHidden = vi.fn();
    render(<Page d={d} onShowHidden={onShowHidden} />);
    fireEvent.click(screen.getByRole("tab", { name: /Hiring for you now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Crypto 1" }));
    fireEvent.click(screen.getByRole("button", { name: "See hidden companies" }));
    expect(onShowHidden).toHaveBeenCalledOnce();
  });
});

describe("Like your past employers", () => {
  it("holds the past-employer editor, and only there", () => {
    render(<Page d={data({ hiringNow: [co("Kraken", { industries: ["crypto"] })] })} />);
    fireEvent.click(screen.getByRole("tab", { name: /Hiring for you now/ }));
    expect(screen.queryByLabelText("You've worked at")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Like your past employers/ }));
    expect(screen.getByText("No past employers yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("You've worked at"), { target: { value: "Careem" } });
    fireEvent.click(screen.getByRole("button", { name: "Add employer" }));
    expect(screen.getByRole("button", { name: "Remove Careem" })).toBeTruthy();
  });
});
