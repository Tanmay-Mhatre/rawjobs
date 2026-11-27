// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Notice, PRIORITY } from "../src/app/notices";
import { SetupChecklist } from "../src/components/Guidance";
import { NoticeSlot, resetNoticeSession } from "../src/components/NoticeSlot";

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

describe("NoticeSlot", () => {
  const notice = (id: string, priority: number): Notice => ({ id, priority, tone: "warn", render: () => <p>Notice {id}</p> });
  const three = [notice("scheduled", PRIORITY.scheduledMissed), notice("telegram", PRIORITY.telegramFailed), notice("failing", PRIORITY.failingCompanies)];
  beforeEach(resetNoticeSession);

  it('3 active → one visible + "2 more notices"', () => {
    render(<NoticeSlot notices={three} />);
    expect(screen.getByText("Notice scheduled")).toBeTruthy();
    expect(screen.queryByText("Notice telegram")).toBeNull();
    expect(screen.getByRole("button", { name: "2 more notices" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("expanding lists the rest", async () => {
    render(<NoticeSlot notices={three} />);
    await userEvent.click(screen.getByRole("button", { name: "2 more notices" }));
    const hide = screen.getByRole("button", { name: "Hide 2 more" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(hide.getAttribute("aria-controls")!)!.textContent).toBe("Notice telegramNotice failing");
  });

  it("says 1 more notice for one", () => {
    render(<NoticeSlot notices={three.slice(0, 2)} />);
    expect(screen.getByRole("button", { name: "1 more notice" })).toBeTruthy();
  });

  it("exactly one live region", () => {
    render(<NoticeSlot notices={[notice("page", PRIORITY.pageFailed), ...three]} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // A page that can't load is also read out at once.
    expect(screen.getByRole("alert").textContent).toBe("Notice page");
    cleanup();
    render(<NoticeSlot notices={three} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a blocking window pauses it, but a notice's dialog stays", () => {
    render(<NoticeSlot paused notices={[{ ...three[0]!, dialog: <p>Its dialog</p> }]} />);
    expect(screen.queryByText("Notice scheduled")).toBeNull();
    expect(screen.getByText("Its dialog")).toBeTruthy();
  });
});
