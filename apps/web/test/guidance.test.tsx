// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupChecklist } from "../src/components/Guidance";

// "Setup complete" asks whether scans are scheduled; no server here.
vi.mock("../src/lib/automation", () => ({ scheduleStatus: () => Promise.resolve({ installed: false }) }));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

type Item = Parameters<typeof SetupChecklist>[0]["items"][number];
const item = (key: string, label: string, done: boolean, extra: Partial<Item> = {}): Item => ({ key, label, detail: done ? "Done" : "Not set", done, ...extra });
const noop = () => {};

describe("SetupChecklist", () => {
  it("before the first scan, shows the full card", () => {
    render(
      <SetupChecklist
        items={[item("roles", "Target roles", true, { step: 2 }), item("keywords", "Topics to rank by", false, { step: 4 }), item("scan", "First scan", false)]}
        onStep={noop}
        onScan={noop}
        onCompanies={noop}
      />,
    );
    expect(screen.getByRole("heading", { name: "Finish setting up" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
  });

  it("after the first scan, collapses to one line with the next step, and Show all reveals the rows", async () => {
    const onStep = vi.fn();
    const items = [
      item("resume", "Master resume", false, { step: 1 }),
      item("keywords", "Topics to rank by", false, { step: 4 }),
      item("companies", "Companies you'd like to work at", false, { optional: true }),
      item("scan", "First scan", true),
    ];
    render(<SetupChecklist items={items} onStep={onStep} onScan={noop} onCompanies={noop} />);
    expect(screen.getByText("2 steps left")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Finish setting up" })).toBeNull();
    expect(screen.queryByText("Topics to rank by")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Master resume" }));
    expect(onStep).toHaveBeenCalledWith(1);

    const toggle = screen.getByRole("button", { name: /show all/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /hide/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Topics to rank by")).toBeTruthy();
  });

  it("says Setup complete when every core step is done", () => {
    render(<SetupChecklist items={[item("roles", "Target roles", true), item("scan", "First scan", true)]} onStep={noop} onScan={noop} onCompanies={noop} />);
    expect(screen.getByText("Setup complete.")).toBeTruthy();
  });
});
