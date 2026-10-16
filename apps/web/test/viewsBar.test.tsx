// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import { ViewsBar } from "../src/components/radar/ViewsBar";
import type { Filters } from "../src/lib/filters";

const base = {} as Filters;
const counts = { all: 552, mine: 71, new: 22, strong: 130, saved: 0, applied: 2 };
const bar = (over: Partial<Parameters<typeof ViewsBar>[0]> = {}) => {
  const onPick = vi.fn();
  render(<ViewsBar base={base} filters={base} sort="best" views={[]} counts={counts} onPick={onPick} onSave={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} {...over} />);
  return { onPick };
};

describe("Radar views", () => {
  it("shows the four views for working through the list as tabs", () => {
    bar();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All552", "My companies71", "New22", "Strong130"]);
  });

  it("keeps Saved and Applied, with their counts and keys, in the Views menu", () => {
    const { onPick } = bar();
    fireEvent.click(screen.getByRole("button", { name: /Views/ }));
    expect(screen.getByRole("menuitem", { name: /Saved · 0/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Applied · 2/ }));
    expect(onPick).toHaveBeenCalledWith({ status: "applied" }, "best");
  });

  it("offers to save the current view from the menu, not a separate button", () => {
    bar({ sort: "newest" });
    expect(screen.queryByRole("button", { name: "Save view" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Views/ }));
    expect(screen.getByRole("menuitem", { name: "Save current view…" })).toBeTruthy();
  });
});
