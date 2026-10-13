// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOUBLE_PRESS_MS, ForYou } from "../src/components/companies/ForYou";
import type { PackActions } from "../src/components/companies/Tray";
import { keyOf, type CompanyRef } from "../src/lib/companies";
import type { CompanySuggestion, CompanySuggestions } from "../src/lib/companySuggest";

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
    industries: ["fintech"],
    hires_for: [],
    reasons: [],
    ...patch,
  };
};

const answer = (patch: Partial<CompanySuggestions> = {}): CompanySuggestions => ({
  hiringNow: [],
  worthWatching: [],
  notScannable: [],
  scanned: 24687,
  pastEmployers: [],
  lookalikes: [],
  packs: [],
  coverage: { in_industries: 0, trackable: 0 },
  index_generated_at: "2026-10-07T09:55:42.522Z",
  ...patch,
});
const none = { hiring: 0, watching: 0, soon: 0, like: {}, packs: {} };

type Spies = { onSeeMine: () => void; onBrowse: () => void; remove: (keys: string[]) => void };

/** ForYou on the Companies page, with My companies kept in state so adds show up as they would. */
function Panel({ data, mine = [], pastEmployers = [], spies }: { data: CompanySuggestions; mine?: string[]; pastEmployers?: string[]; spies: Spies }) {
  const [watched, setWatched] = useState(() => new Set(mine));
  const add = (refs: CompanyRef[]) => {
    const keys = refs.map(keyOf);
    setWatched((w) => new Set([...w, ...keys]));
    return keys;
  };
  const remove = (keys: string[]) => {
    spies.remove(keys);
    setWatched((w) => new Set([...w].filter((k) => !keys.includes(k))));
  };
  const packActions: PackActions = { add: (refs) => void add(refs), remove: (keys) => remove(keys) };
  return (
    <ForYou
      state={{ kind: "ready", data }}
      watched={watched}
      muted={new Set()}
      pastEmployers={pastEmployers}
      onPastEmployers={() => {}}
      onAddMany={add}
      onRemoveMany={remove}
      onMute={() => {}}
      onUnmute={() => {}}
      industries={3}
      packActions={packActions}
      onSeeMine={spies.onSeeMine}
      onBrowse={spies.onBrowse}
    />
  );
}

const spies = (): Spies => ({ onSeeMine: vi.fn(), onBrowse: vi.fn(), remove: vi.fn() });
const show = (data: CompanySuggestions, opts: { mine?: string[]; pastEmployers?: string[] } = {}) => {
  const s = spies();
  const view = render(<Panel data={data} spies={s} {...opts} />);
  return { ...s, view };
};
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const allInCheck = (t: HTMLElement) => within(t).queryByRole("img", { name: "all in My companies" });
/** The "all added" block: a solid border, never the dashed "nothing found" one. */
const doneBlock = (title: string) => {
  const block = screen.getByText(title).parentElement!;
  expect(block.className).not.toMatch(/border-dashed/);
  expect(block.querySelector("svg.lucide-circle-check")).not.toBeNull();
  return block;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const crypto = [co("Ledger", { industries: ["crypto"] }), co("Kraken", { industries: ["crypto"] })];
const fintech = [co("Aven"), co("Moment"), co("Rillet")];
const packs = [
  { industry: "crypto", items: crypto },
  { industry: "fintech", items: fintech },
];

describe("Starter packs, every pack added", () => {
  it("this visit: the line says so and Add all becomes See My companies, which ignores a double press", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const s = show(answer({ packs, added: none }));
    expect(screen.getByText("2 packs from your industries")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Add all 5" });
    fireEvent.click(button);
    expect(screen.getByText("All 5 starter-pack companies are in My companies")).toBeTruthy();
    // The same button, so focus stays on it.
    expect(button.textContent).toBe("See My companies");
    now += DOUBLE_PRESS_MS - 1;
    fireEvent.click(button);
    expect(s.onSeeMine).not.toHaveBeenCalled();
    now += 1;
    fireEvent.click(button);
    expect(s.onSeeMine).toHaveBeenCalledTimes(1);
    // The cards keep Remove pack; the tab keeps its count this visit.
    expect(screen.getAllByRole("button", { name: /^Remove the .* pack$/ })).toHaveLength(2);
    expect(allInCheck(tab(/Starter packs/))).toBeNull();
  });

  it("next visit: the tab stays with a check, the page opens on it, and it says what's next", () => {
    const keys = { crypto: ["lever:a", "lever:b"], fintech: ["lever:b", "lever:c", "lever:d"] };
    const s = show(answer({ hiringNow: fintech, packs: [], added: { ...none, packs: keys } }), { mine: ["lever:a", "lever:b", "lever:c", "lever:d"] });
    const t = tab(/Starter packs/);
    expect(t.getAttribute("aria-selected")).toBe("true");
    expect(allInCheck(t)).not.toBeNull();
    expect(t.textContent).not.toMatch(/\d/);
    const block = doneBlock("Every starter pack is in My companies");
    expect(block.textContent).toMatch("You've added all 4 companies from your 2 packs. New companies in your industries show up here when the directory updates.");
    fireEvent.click(within(block).getByRole("button", { name: "See My companies" }));
    expect(s.onSeeMine).toHaveBeenCalled();
    fireEvent.click(within(block).getByRole("button", { name: "Try Hiring for you now" }));
    expect(tab(/Hiring for you now/).getAttribute("aria-selected")).toBe("true");
  });
});

describe("one pack fully added, next visit", () => {
  it("folds into a line at the end that opens to a short finished card, with Remove pack", () => {
    const brokerage = ["lever:public", "lever:thndr", "lever:tickmill"];
    const s = show(answer({ packs, added: { ...none, packs: { brokerage } } }), { mine: brokerage });
    expect(screen.getByText("3 packs from your industries")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add all 5" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Brokerage, CFD & FX" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 pack fully added", expanded: false }));
    const card = screen.getByRole("region", { name: "Brokerage, CFD & FX" });
    expect(card.textContent).toMatch("All 3 in My companies");
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.at(-1)).toBe("Brokerage, CFD & FX");
    fireEvent.click(within(card).getByRole("button", { name: "Remove the Brokerage, CFD & FX pack" }));
    expect(s.remove).toHaveBeenCalledWith(brokerage);
    // Its companies left My companies, so the card goes (the tray offers Undo).
    expect(screen.queryByRole("region", { name: "Brokerage, CFD & FX" })).toBeNull();
  });
});

describe("many packs fully added, next visit", () => {
  const finishedPacks = { brokerage: ["lever:public", "lever:thndr"], payments: ["lever:stripe", "lever:adyen", "lever:wise"], "digital-bank": ["lever:revolut"] };
  const mine = Object.values(finishedPacks).flat();

  it("the packs with something left keep their cards; the rest fold into one line after them", () => {
    show(answer({ packs, added: { ...none, packs: finishedPacks } }), { mine });
    expect(screen.getAllByRole("region")).toHaveLength(2);
    const toggle = screen.getByRole("button", { name: "3 packs fully added" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("3 packs fully added·Show");
    // It comes after every card that still has companies to add.
    const lastCard = screen.getByRole("region", { name: "Fintech (general)" });
    expect(lastCard.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
  });

  it("opens in place below the line and closes again, with focus kept on the toggle", () => {
    show(answer({ packs, added: { ...none, packs: finishedPacks } }), { mine });
    const toggle = screen.getByRole("button", { name: "3 packs fully added" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toMatch(/Hide$/);
    expect(document.activeElement).toBe(toggle);
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(false);
    expect(toggle.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(list).getAllByRole("button", { name: /^Remove the .* pack$/ })).toHaveLength(3);
    // Every finished card says how many of its companies are in My companies, one included.
    expect(within(list).getByRole("region", { name: "Digital bank / neobank" }).textContent).toMatch("1 in My companies");
    expect(within(list).getByRole("region", { name: "Payments" }).textContent).toMatch("All 3 in My companies");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
    expect(within(list).queryByRole("region")).toBeNull();
  });

  it("every pack added: the block says so, with the folded line under it for Remove pack", () => {
    const s = show(answer({ hiringNow: fintech, packs: [], added: { ...none, packs: finishedPacks } }), { mine });
    doneBlock("Every starter pack is in My companies");
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "3 packs fully added" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the Payments pack" }));
    expect(s.remove).toHaveBeenCalledWith(finishedPacks.payments);
    expect(screen.getByRole("button", { name: "2 packs fully added" })).toBeTruthy();
  });
});

describe("the panel's top", () => {
  it("has no gap above the tabs, loading or loaded, so nothing moves when the answer arrives", () => {
    const first = (c: HTMLElement) => [...c.firstElementChild!.children].find((el) => !el.classList.contains("sr-only")) as HTMLElement;
    const { view } = show(answer({ packs, added: none }));
    expect(first(view.container).className).not.toMatch(/(^|\s)mt-/);
    cleanup();
    const loading = render(
      <ForYou
        state={{ kind: "loading" }}
        watched={new Set()}
        muted={new Set()}
        pastEmployers={[]}
        onPastEmployers={() => {}}
        onAddMany={() => []}
        onRemoveMany={() => {}}
        onMute={() => {}}
        onUnmute={() => {}}
        industries={3}
      />,
    );
    const top = first(loading.container);
    expect(top.dataset.lens).toBe("packs");
    expect(top.className).not.toMatch(/(^|\s)mt-/);
  });
});

describe("the other lenses, all added", () => {
  it("Hiring for you now: a count and two ways on", () => {
    show(answer({ worthWatching: [co("Kit")], added: { ...none, hiring: 30 } }));
    fireEvent.click(tab(/Hiring for you now/));
    expect(allInCheck(tab(/Hiring for you now/))).not.toBeNull();
    const block = doneBlock("Every company hiring for you is in My companies");
    expect(block.textContent).toMatch("All 30 are in your list. New matches show up here when the directory updates.");
    fireEvent.click(within(block).getByRole("button", { name: "Try Not hiring yet" }));
    expect(tab(/Not hiring yet/).getAttribute("aria-selected")).toBe("true");
  });

  it("Hiring for you now, this visit: the Add top 10 slot says they're all in", () => {
    const hiring = [co("Nebius"), co("Headway"), co("Kit")];
    show(answer({ hiringNow: hiring, added: none }), { mine: hiring.map(keyOf) });
    expect(screen.getByText("All 3 in My companies")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add (top|all)/ })).toBeNull();
  });

  it("Like your past employers: names the employer and points at the field above", () => {
    show(answer({ hiringNow: [co("Nebius")], added: { ...none, like: { Careem: 4 } } }), { pastEmployers: ["Careem"] });
    fireEvent.click(tab(/Like your past employers/));
    expect(screen.getByRole("form", { name: "Past employers" })).toBeTruthy();
    const block = doneBlock("Every company like Careem is in My companies");
    expect(block.textContent).toMatch("Add another past employer above to see companies like it.");
    expect(screen.queryByText(/No close match yet/)).toBeNull();
  });

  it("Not hiring yet: See My companies or Browse all companies", () => {
    const s = show(answer({ added: { ...none, watching: 30 } }));
    expect(tab(/Not hiring yet/).getAttribute("aria-selected")).toBe("true");
    const block = doneBlock("Every company worth watching is in My companies");
    expect(block.textContent).toMatch("All 30 are in your list. New ones show up here when the directory updates.");
    expect(screen.queryByText(/Nothing open for you yet/)).toBeNull();
    fireEvent.click(within(block).getByRole("button", { name: "Browse all companies" }));
    expect(s.onBrowse).toHaveBeenCalled();
  });

  it("Not supported yet: the tab stays while you have companies from it", () => {
    show(answer({ hiringNow: [co("Nebius")], added: { ...none, soon: 4 } }));
    fireEvent.click(tab(/Not supported yet/));
    expect(allInCheck(tab(/Not supported yet/))).not.toBeNull();
    const block = doneBlock("All 4 not-yet-supported companies are in My companies");
    expect(block.textContent).toMatch("RawJobs starts checking them once their job sites are supported.");
  });
});

describe("no suggestions, for contrast", () => {
  it("says nothing was found, on a dashed border, with the real count and ways on", () => {
    show(answer({ worthWatching: [co("Kit")], added: none }));
    fireEvent.click(tab(/Hiring for you now/));
    const title = screen.getByText("No company is hiring for you today");
    expect(title.parentElement!.className).toMatch(/border-dashed/);
    expect(title.parentElement!.querySelector("svg")).toBeNull();
    expect(title.parentElement!.textContent).toMatch("None of the 24,687 companies has an opening that passes your title and place filters.");
    expect(screen.getByRole("link", { name: "Widen your places" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try Not hiring yet" })).toBeTruthy();
    expect(allInCheck(tab(/Hiring for you now/))).toBeNull();
    expect(screen.queryByText(/in My companies/)).toBeNull();
  });

  it("is what an older answer (no counts) shows, as before", () => {
    show(answer({ worthWatching: [co("Kit")] }));
    fireEvent.click(tab(/Hiring for you now/));
    expect(screen.getByText("No company is hiring for you today")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Starter packs/ })).toBeNull();
  });
});
