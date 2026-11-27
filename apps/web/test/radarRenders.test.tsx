// @vitest-environment happy-dom
// How much work the Radar does per change: which passes run, how many commits, what gets written.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { memo, Profiler, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataMeta, Job, Profile } from "../src/lib/data";
import { DEFAULT_FILTERS } from "../src/lib/filters";
import type { Status, UserState } from "../src/lib/userState";
import { makeJob } from "./helpers";

const calls = { facet: 0, apply: 0, card: 0, detail: 0 };
/** The details panel throws for this job id. */
let crashFor: string | undefined;
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

// Count renders of the real row and details components, keeping their memo compare.
vi.mock("../src/components/radar/JobCard", async (orig) => {
  const m = await orig<typeof import("../src/components/radar/JobCard")>();
  const inner = m.JobCard as unknown as { type: (p: object) => ReactNode; compare: (a: object, b: object) => boolean };
  const Counted = memo((p: object) => {
    calls.card++;
    return inner.type(p);
  }, inner.compare);
  return { ...m, JobCard: Counted };
});
vi.mock("../src/components/JobDetail", async (orig) => {
  const m = await orig<typeof import("../src/components/JobDetail")>();
  const inner = m.JobDetail as unknown as { type: (p: { job: Job }) => ReactNode };
  const Counted = memo((p: { job: Job }) => {
    calls.detail++;
    if (p.job.id === crashFor) throw new Error("details broke");
    return inner.type(p);
  });
  return { ...m, JobDetail: Counted };
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

// Stable, as App keeps them.
const prefs = { views: [], hiddenCompanies: [], hideRules: [] };
const notYours = () => false;
let commits = 0;
/** Re-renders the page with the same data, as App does on each scan event. */
let tick = noop;
/** Like App: state in the parent, new inline handlers on every render. */
function Harness() {
  const [, setTick] = useState(0);
  const [user, setUser] = useState<UserState>({});
  tick = () => setTick((t) => t + 1);
  return (
    <Profiler id="radar" onRender={() => void commits++}>
      <RadarPage
        jobs={jobs}
        meta={meta}
        user={user}
        prefs={prefs}
        onOpenOverlay={(j) => void j}
        overlayOpen={false}
        onStatus={(j: Job, status: Status) =>
          setUser((u) => ({ ...u, [j.id]: { status, updatedAt: new Date().toISOString(), snapshot: { title: j.title, company: j.company, url: j.url, location: j.location, score: j.score } } }))
        }
        onUpdate={() => {}}
        onApply={(j) => void j}
        onSaveView={() => ({ id: "v", name: "", filters: DEFAULT_FILTERS, sort: "best" })}
        onRenameView={noop}
        onDeleteView={noop}
        onRestoreView={noop}
        onHideCompany={noop}
        isYours={notYours}
        companyCount={0}
        onCompanies={noop}
        onEditProfile={() => {}}
      />
    </Profiler>
  );
}
const renderRadar = () => render(<Harness />);
const reset = () => {
  calls.facet = 0;
  calls.apply = 0;
  calls.card = 0;
  calls.detail = 0;
  commits = 0;
};
const search = () => screen.getByRole("searchbox", { name: "Search jobs" });
const type = async (text: string) => {
  for (let i = 1; i <= text.length; i++) {
    act(() => void fireEvent.change(search(), { target: { value: text.slice(0, i) } }));
    await act(async () => {});
  }
};

afterEach(() => {
  cleanup();
  crashFor = undefined;
});
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

describe("Radar rows and details skip renders", () => {
  const mount = async () => {
    renderRadar();
    await act(async () => {});
    reset();
  };
  const current = () => document.querySelector('.rj-row[aria-current="true"] [data-job-link]')?.textContent;

  it("a scan tick (same props) renders 0 JobCards and 0 JobDetail", async () => {
    await mount();
    act(() => tick());
    expect(commits).toBe(1);
    expect(calls.card).toBe(0);
    expect(calls.detail).toBe(0);
  });

  it("saving one job renders exactly 1 JobCard", async () => {
    await mount();
    const save = screen.getAllByRole("button", { name: /^Save/ })[1]!;
    act(() => void fireEvent.click(save));
    await act(async () => {});
    expect(save.getAttribute("aria-pressed")).toBe("true");
    expect(calls.card).toBe(1);
  });

  it("j renders only the old and new current rows (2)", async () => {
    await mount();
    const first = current();
    act(() => void fireEvent.keyDown(window, { key: "j" }));
    await act(async () => {});
    expect(current()).not.toBe(first);
    expect(calls.card).toBe(2);
    // The newly current row's title has focus (the row kept its element for J/K).
    expect(document.activeElement?.textContent).toBe(current());
  });

  it("a crash in the detail panel keeps the list, and picking another job recovers", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(noop);
    crashFor = jobs[0]!.id;
    renderRadar();
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Something went wrong on this job" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Jobs" })).toBeTruthy();
    act(() => void fireEvent.click(screen.getAllByRole("button", { name: TITLES[1] })[0]!));
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: "Something went wrong on this job" })).toBeNull();
    expect(screen.getByRole("heading", { name: TITLES[1], level: 2 })).toBeTruthy();
    quiet.mockRestore();
  });
});
