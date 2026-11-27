// @vitest-environment happy-dom
// How much work the Radar does per change: which passes run, how many commits, what gets written.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataMeta, Job, Profile } from "../src/lib/data";
import { DEFAULT_FILTERS } from "../src/lib/filters";
import { makeJob } from "./helpers";

const calls = { facet: 0, apply: 0 };
vi.mock("../src/lib/filters", async (orig) => {
  const m = await orig<typeof import("../src/lib/filters")>();
  return {
    ...m,
    facetCounts: (...a: Parameters<typeof m.facetCounts>) => {
      calls.facet++;
      return m.facetCounts(...a);
    },
    applyFilters: (...a: Parameters<typeof m.applyFilters>) => {
      calls.apply++;
      return m.applyFilters(...a);
    },
  };
});

const { RadarPage } = await import("../src/components/radar/RadarPage");

const TITLES = ["Product Manager", "Data Analyst", "Software Engineer", "Designer", "Marketing Lead", "Sales Manager"];
// Acme posts six roles, so the list folds four of them under "+4 more at Acme"; the rest are one role each.
const jobs: Job[] = [
  ...TITLES.map((title, i) => makeJob({ id: `greenhouse:acme:${i}`, title, score: 90 - i })),
  ...Array.from({ length: 30 }, (_, i) => makeJob({ id: `lever:co${i}:${i}`, ats: "lever", company: `Co${i}`, companyKey: `lever:co${i}`, title: TITLES[i % TITLES.length], score: 40 + i })),
];
const profile = {
  name: "Me",
  titles: { include: ["product manager"], exclude: [] },
  seniority_boost: [],
  locations: { include: [], remote_ok: [], remote_exclude: [], workplace: [] },
  industries: [],
  past_employers: [],
  keywords: {},
  min_score: 65,
} as unknown as Profile;
const meta = { version: 1, generatedAt: new Date().toISOString(), profile, companies: [], runs: [] } as unknown as DataMeta;
const noop = () => {};

let commits = 0;
const renderRadar = () =>
  render(
    <Profiler id="radar" onRender={() => void commits++}>
      <RadarPage
        jobs={jobs}
        meta={meta}
        user={{}}
        prefs={{ views: [], hiddenCompanies: [], hideRules: [] }}
        onOpenOverlay={noop}
        overlayOpen={false}
        onStatus={noop}
        onUpdate={noop}
        onApply={noop}
        onSaveView={() => ({ id: "v", name: "", filters: DEFAULT_FILTERS, sort: "best" })}
        onRenameView={noop}
        onDeleteView={noop}
        onRestoreView={noop}
        onHideCompany={noop}
        isYours={() => false}
        companyCount={0}
        onCompanies={noop}
        onEditProfile={noop}
      />
    </Profiler>,
  );
const reset = () => {
  calls.facet = 0;
  calls.apply = 0;
  commits = 0;
};
const search = () => screen.getByRole("searchbox", { name: "Search jobs" });
const type = async (text: string) => {
  for (let i = 1; i <= text.length; i++) {
    act(() => void fireEvent.change(search(), { target: { value: text.slice(0, i) } }));
    await act(async () => {});
  }
};

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  // A laptop: the list and the details side by side, filters in a row under the search.
  window.matchMedia = ((q: string) => ({
    matches: q.includes("min-width"),
    media: q,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe("Radar work per change", () => {
  it("search typing does not compute facet counts while the filter panel is closed", async () => {
    renderRadar();
    await act(async () => {});
    reset();
    await type("pro");
    expect(calls.facet).toBe(0);
  });

  it("opening Filters computes facet counts once and shows them", async () => {
    renderRadar();
    await act(async () => {});
    expect(calls.facet).toBe(0);
    act(() => void fireEvent.click(screen.getByRole("button", { name: /^Filters/ })));
    expect(calls.facet).toBe(1);
    expect(screen.getByRole("button", { name: /^Country/ })).toBeTruthy();
  });

  it("search keystroke runs applyFilters once for the list (not twice)", async () => {
    renderRadar();
    await act(async () => {});
    reset();
    await type("pro");
    // Per key: the list, and the "Show older jobs (N)" count. Before, the list's passes ran urgent and deferred.
    expect(calls.apply).toBeLessThanOrEqual(2 * 3);
  });

  it("opened companies and paging reset when the sort changes, without an extra commit", async () => {
    renderRadar();
    await act(async () => {});
    act(() => void fireEvent.click(screen.getByRole("button", { name: "+4 more at Acme" })));
    expect(screen.queryByRole("button", { name: "+4 more at Acme" })).toBeNull();
    reset();
    act(() => void fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "salary" } }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "+4 more at Acme" })).toBeTruthy();
    expect(commits).toBe(1);
  });

  it("typing in search does not write rawjobs.radar.v2", async () => {
    renderRadar();
    await act(async () => {});
    const setItem = vi.spyOn(localStorage, "setItem");
    await type("pro");
    expect(setItem.mock.calls.filter(([k]) => k === "rawjobs.radar.v2")).toEqual([]);
    // A kept change still is.
    act(() => void fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "salary" } }));
    expect(setItem.mock.calls.filter(([k]) => k === "rawjobs.radar.v2")).toHaveLength(1);
    setItem.mockRestore();
  });
});
