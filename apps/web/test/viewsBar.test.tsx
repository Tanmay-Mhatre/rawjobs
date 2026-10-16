// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import { ViewsBar } from "../src/components/radar/ViewsBar";
import type { Filters } from "../src/lib/filters";

const base = {} as Filters;
const counts = { mine: 71, new: 22, strong: 130 };
const bar = (over: Partial<Parameters<typeof ViewsBar>[0]> = {}) => {
  const onPick = vi.fn();
  render(<ViewsBar base={base} filters={base} sort="best" views={[]} counts={counts} onPick={onPick} onSave={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} {...over} />);
  return { onPick };
};

describe("Radar views", () => {
  it("shows My companies, New and Strong as chips with counts, and no All tab", () => {
    bar();
    const chips = screen.getAllByRole("button", { pressed: false });
    expect(chips.map((c) => c.textContent)).toEqual(["My companies71", "New22", "Strong130"]);
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("stacks chips: turning one on keeps the others and your search", () => {
    const { onPick } = bar({ filters: { status: "new", q: "payments" } as Filters });
    expect(screen.getByRole("button", { name: /^New/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Strong/ }));
    expect(onPick).toHaveBeenCalledWith({ status: "new", q: "payments", match: "strong" }, "best");
  });

  it("turns a chip off back to your profile's own value", () => {
    const { onPick } = bar({ base: { match: "all" } as Filters, filters: { match: "strong" } as Filters });
    fireEvent.click(screen.getByRole("button", { name: /^Strong/ }));
    expect(onPick).toHaveBeenCalledWith({ match: "all" }, "best");
  });

  it("has no New chip on the first scan", () => {
    bar({ hideNew: true });
    expect(screen.queryByRole("button", { name: /^New/ })).toBeNull();
  });

  it("leaves saved and applied jobs to the Pipeline, and shows no empty Views menu", () => {
    bar();
    expect(screen.queryByRole("button", { name: /Views/ })).toBeNull();
    cleanup();
    bar({ views: [{ id: "v1", name: "Dubai fintech", filters: base, sort: "best" }] as never, sort: "newest" });
    fireEvent.click(screen.getByRole("button", { name: /Views/ }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Dubai fintech", "Save current view…"]);
  });

  it("offers to save the current view from the menu, not a separate button", () => {
    bar({ sort: "newest" });
    expect(screen.queryByRole("button", { name: "Save view" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Views/ }));
    expect(screen.getByRole("menuitem", { name: "Save current view…" })).toBeTruthy();
  });
});
