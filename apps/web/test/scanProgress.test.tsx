// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanBars } from "../src/components/ScanBars";
import { ScanStatus } from "../src/components/ScanButton";
import { ScanProgress } from "../src/components/ScanProgress";
import { shortCount } from "../src/lib/format";
import { applyScanEvent, progressRows, splitProgress, withLive, type ScanState } from "../src/lib/scan";
import { makeJob } from "./helpers";
import type { RunEvent } from "../src/lib/setup";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A window as wide (or as narrow) as a phone, for useMedia("(max-width: 639px)"). */
const screenWidth = (px: number) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: /max-width: 639px/.test(q) && px <= 639, addEventListener() {}, removeEventListener() {} }));

const IDLE: ScanState = { phase: "running", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: [] };
const health = (company: string, ats: "greenhouse" | "lever", matches = 0) => ({ company, ats, slug: company.toLowerCase(), ok: true, jobsFound: 10, matches, durationMs: 5 });
const play = (events: RunEvent[], from: ScanState = IDLE) => events.reduce(applyScanEvent, from);

describe("applyScanEvent", () => {
  it("keeps per-hiring-system totals from start and done counts from company and progress events", () => {
    const s = play([
      { type: "start", companies: ["Acme"], total: 5, resumed: 1, byAts: { greenhouse: 3, lever: 2 }, doneByAts: { lever: 1 } },
      { type: "company", done: 2, doneByAts: { lever: 1, greenhouse: 1 }, ...health("Acme", "greenhouse", 2) },
      { type: "progress", done: 3, ats: "lever", doneByAts: { lever: 2, greenhouse: 1 } },
    ]);
    expect(s.byAts).toEqual({ greenhouse: 3, lever: 2 });
    expect(s.doneByAts).toEqual({ lever: 2, greenhouse: 1 });
    expect(s.done).toBe(3);
    expect(s.resumed).toBe(1);
    expect(s.results.Acme).toMatchObject({ matches: 2 });
    expect(s.results.Acme).not.toHaveProperty("doneByAts");
    expect(progressRows(s)).toEqual([
      { ats: "greenhouse", total: 3, done: 1 },
      { ats: "lever", total: 2, done: 2 },
    ]);
  });

  it("works with an older CLI that sends no breakdown: one row for all companies", () => {
    const s = play([
      { type: "start", companies: ["Acme"], total: 4 },
      { type: "company", done: 1, ...health("Acme", "greenhouse") },
      { type: "progress", done: 2 },
    ]);
    expect(s.byAts).toBeUndefined();
    expect(progressRows(s)).toEqual([{ ats: "", total: 4, done: 2 }]);
  });
});

describe("streamed matches", () => {
  it("collects each company's matches as they come, the latest copy of a job winning", () => {
    const s = play([
      { type: "jobs", jobs: [makeJob({ id: "a", score: 60 }), makeJob({ id: "b" })] },
      { type: "jobs", jobs: [makeJob({ id: "a", score: 80 })] },
    ]);
    expect(s.live.map((j) => [j.id, j.score])).toEqual([
      ["b", makeJob({ id: "b" }).score],
      ["a", 80],
    ]);
  });

  it("puts new matches on top of the Radar and updates the ones it has, keeping what only the saved files know", () => {
    const saved = [makeJob({ id: "a", score: 50, industries: ["fintech"] }), makeJob({ id: "c" })];
    const shown = withLive(saved, [makeJob({ id: "a", score: 90 }), makeJob({ id: "new" })]);
    expect(shown.map((j) => j.id)).toEqual(["new", "a", "c"]);
    expect(shown[1]).toMatchObject({ score: 90, industries: ["fintech"] });
    expect(withLive(saved, [])).toBe(saved);
  });
});

describe("ScanProgress", () => {
  it("shows one bar per hiring system, biggest first, with counts and no percentage", () => {
    const s = play([{ type: "start", companies: [], total: 184, byAts: { lever: 64, greenhouse: 120 }, doneByAts: { greenhouse: 41, lever: 64 } }]);
    render(<ScanProgress scan={{ ...s, done: 105 }} />);
    const group = screen.getByRole("list", { name: "By hiring system" });
    const rows = group.querySelectorAll(".rj-progress__row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("41 / 120")).toBeTruthy();
    expect(rows[0]!.querySelector(".rj-source")?.textContent).toMatch(/greenhouse/i);
    expect((rows[0]!.querySelector(".rj-progress__fill") as HTMLElement).style.transform).toMatch(/scaleX\(0\.341/);
    expect(within(rows[1] as HTMLElement).getByText("64 / 64")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%/);
  });

  it("falls back to one All companies row", () => {
    render(<ScanProgress scan={{ ...IDLE, total: 120, done: 41 }} />);
    const group = screen.getByRole("list", { name: "By hiring system" });
    expect(within(group).getByText("All companies")).toBeTruthy();
    expect(within(group).getByText("41 / 120")).toBeTruthy();
  });
});

describe("shortCount", () => {
  it("stays exact below 10,000 and shortens from there", () => {
    expect(shortCount(41)).toBe("41");
    expect(shortCount(9999)).toBe((9999).toLocaleString());
    expect(shortCount(12215)).toMatch(/^12\.2\s?K$/i);
  });
});

describe("splitProgress", () => {
  const row = (done: number, total: number) => ({ done, total });
  it("keeps short lists whole and in place", () => {
    const rows = [row(1, 1), row(0, 4)];
    expect(splitProgress(rows, 5)).toEqual({ shown: rows, rest: [], done: [], inPlace: true });
  });

  it("shows the first unfinished rows in their order and folds finished ones away", () => {
    const rows = [row(1, 9), row(8, 8), row(0, 7), row(2, 6), row(5, 5), row(0, 4), row(1, 3)];
    const { shown, rest, done, inPlace } = splitProgress(rows, 3);
    expect(inPlace).toBe(false);
    expect(shown).toEqual([row(1, 9), row(0, 7), row(2, 6)]);
    expect(rest).toEqual([row(0, 4), row(1, 3)]);
    expect(done).toEqual([row(8, 8), row(5, 5)]);
  });
});

describe("ScanBars", () => {
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k, i) => ({ key: k, label: `System ${k}`, total: 100 - i, done: i < 2 ? 100 - i : 3 }));

  it("shows five unfinished rows, a done count and Show all on a wide screen", () => {
    screenWidth(1280);
    render(<ScanBars rows={eight} noun="hiring system" />);
    const list = screen.getByRole("list", { name: "By hiring system" });
    expect(list.querySelectorAll(".rj-progress__row")).toHaveLength(5);
    expect(screen.getByText("2 hiring systems done")).toBeTruthy();
    expect(screen.queryByText(/System a/)).toBeNull();
    const more = screen.getByRole("button", { name: /Show all 6 hiring systems/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(list.querySelectorAll(".rj-progress__row")).toHaveLength(6);
    expect(list.classList.contains("rj-progress--scroll")).toBe(true);
    expect(screen.getByRole("button", { name: /Show fewer/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows three rows on a phone", () => {
    screenWidth(375);
    render(<ScanBars rows={eight} noun="hiring system" />);
    expect(screen.getByRole("list", { name: "By hiring system" }).querySelectorAll(".rj-progress__row")).toHaveLength(3);
  });

  it("says every system is checked when none is left", () => {
    screenWidth(1280);
    const rows = eight.map((r) => ({ ...r, done: r.total }));
    render(<ScanBars rows={rows} noun="hiring system" />);
    expect(screen.getByText("All 8 hiring systems checked")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ScanStatus", () => {
  it("shows an overall bar and short counts, with full numbers for screen readers", () => {
    screenWidth(1280);
    const s = play([{ type: "start", companies: [], total: 22640, byAts: { smartrecruiters: 12215, bamboohr: 10425 }, doneByAts: { smartrecruiters: 142, bamboohr: 326 } }]);
    render(<ScanStatus scan={{ ...s, done: 468 }} onStop={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /show details/ }));
    const bar = screen.getByRole("progressbar", { name: "Scan progress" });
    expect(bar.getAttribute("aria-valuetext")).toBe(`468 of ${(22640).toLocaleString()} companies`);
    const row = screen.getByRole("list", { name: "By hiring system" }).querySelector(".rj-progress__row") as HTMLElement;
    expect(row.querySelector(".rj-progress__count")?.textContent).toMatch(/^142 \/ 12\.2\s?K$/i);
    expect(within(row).getByText(`142 of ${(12215).toLocaleString()} companies`)).toBeTruthy();
  });
});
