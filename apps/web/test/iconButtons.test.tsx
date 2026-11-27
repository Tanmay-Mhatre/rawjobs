// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyCompanies } from "../src/components/Companies";
import { PastEmployers } from "../src/components/companies/ForYou";
import { QuickAdd } from "../src/components/companies/QuickAdd";
import { SetupChecklist } from "../src/components/Guidance";
import { IconLink } from "../src/components/primitives";
import { ScheduledScans } from "../src/components/ScheduledScans";
import type { CompanyRow } from "../src/lib/setup";

vi.mock("../src/lib/automation", async (orig) => ({
  ...(await orig<typeof import("../src/lib/automation")>()),
  scheduleStatus: async () => ({ supported: true, installed: false, runs: [] }),
}));
vi.mock("../src/lib/setup", async (orig) => ({ ...(await orig<typeof import("../src/lib/setup")>()), scanPlan: () => new Promise(() => {}) }));

afterEach(cleanup);

/** Every swapped icon button is the shared primitive: named, small, with a tooltip instead of a native title. */
function expectIconButton(el: HTMLElement) {
  expect(el.className).toContain("rj-btn--icon");
  expect(el.className).toContain("rj-btn--sm");
  expect(el.title).toBe("");
  expect(el.querySelector(".rj-tip")?.textContent).toBe(el.getAttribute("aria-label"));
}

describe("icon buttons", () => {
  it("IconLink: an icon-only link named by its label, opening in a new tab", () => {
    render(
      <IconLink size="sm" href="https://example.com/jobs" label="Open Acme careers page (opens in a new tab)">
        <svg />
      </IconLink>,
    );
    const a = screen.getByRole("link", { name: "Open Acme careers page (opens in a new tab)" });
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer");
    expectIconButton(a);
  });

  it("My companies: a pasted careers link gets an IconLink that says it opens a new tab", () => {
    const row: CompanyRow = { id: "x", input: "https://careers.acme.com/jobs", state: "saved", name: "Acme" };
    render(<MyCompanies rows={[row]} savedKeys={new Set()} onRemove={() => {}} onRemoveMany={() => {}} />);
    const links = screen.getAllByRole("link", { name: "Open Acme careers page (opens in a new tab)" });
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expectIconButton(a);
  });

  it("Past employers: Remove {name}", async () => {
    const onChange = vi.fn();
    render(<PastEmployers names={["Careem"]} onChange={onChange} />);
    const b = screen.getByRole("button", { name: "Remove Careem" });
    expectIconButton(b);
    await userEvent.click(b);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("Quick add: Clear search", async () => {
    const onQ = vi.fn();
    render(<QuickAdd q="acme" onQ={onQ} count={0} linkOpen={false} onToggleLink={() => {}} linkPanelId="p" />);
    const b = screen.getByRole("button", { name: "Clear search" });
    expectIconButton(b);
    await userEvent.click(b);
    expect(onQ).toHaveBeenCalledWith("");
  });

  it("Setup checklist, complete: Hide setup checklist", () => {
    const item = (key: string, label: string, done: boolean) => ({ key, label, done }) as Parameters<typeof SetupChecklist>[0]["items"][number];
    render(<SetupChecklist items={[item("roles", "Target roles", true), item("scan", "First scan", true)]} onStep={() => {}} onScan={() => {}} onCompanies={() => {}} />);
    expectIconButton(screen.getByRole("button", { name: "Hide setup checklist" }));
  });

  it("Scheduled scans: Remove {time}", async () => {
    render(<ScheduledScans />);
    await userEvent.click(await screen.findByRole("button", { name: /Twice a day/ }));
    const b = screen.getByRole("button", { name: "Remove 20:00" });
    expectIconButton(b);
    await userEvent.click(b);
    expect(screen.queryByRole("button", { name: /^Remove \d/ })).toBeNull();
  });
});
