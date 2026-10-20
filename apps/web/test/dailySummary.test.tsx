// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_TIMES, DailySummary, dailyLine } from "../src/components/DailySummary";
import type { DailySummaryStatus } from "../src/lib/automation";

const api = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), remove: vi.fn(), test: vi.fn() }));
vi.mock("../src/lib/automation", () => ({
  dailySummaryStatus: () => api.status(),
  saveDailySummary: (time: string) => api.save(time),
  removeDailySummary: () => api.remove(),
  testDailySummary: () => api.test(),
}));

const status = (s: Partial<DailySummaryStatus> = {}): DailySummaryStatus => ({ ok: true, installed: false, supported: true, platform: "win32", last: null, telegram: true, ...s });
const at = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(cleanup);

describe("Daily summary setting", () => {
  it("offers morning times in 30-minute steps, 09:00 by default", async () => {
    expect(DAILY_TIMES[0]).toBe("05:00");
    expect(DAILY_TIMES.at(-1)).toBe("11:30");
    expect(DAILY_TIMES).toContain("09:00");
    api.status.mockResolvedValue(status());
    render(<DailySummary />);
    expect(((await screen.findByRole("combobox")) as HTMLSelectElement).value).toBe("09:00");
  });

  it("is off and can't be turned on until Telegram is set up", async () => {
    api.status.mockResolvedValue(status({ telegram: false }));
    render(<DailySummary />);
    const toggle = (await screen.findByRole("checkbox", { name: "Daily summary of today's tasks" })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText(/Set up Telegram first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send a test now/ })).toBeNull();
  });

  it("can still be turned off after Telegram is disconnected", async () => {
    api.status.mockResolvedValue(status({ telegram: false, installed: true, settings: { time: "09:00" } }));
    api.remove.mockResolvedValue(status({ telegram: false }));
    render(<DailySummary />);
    const toggle = (await screen.findByRole("checkbox", { name: "Daily summary of today's tasks" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
  });

  it("turns on at the chosen time, and says what it includes", async () => {
    api.status.mockResolvedValue(status());
    api.save.mockResolvedValue(status({ installed: true, settings: { time: "08:30" } }));
    render(<DailySummary />);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "08:30" } });
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Daily summary of today's tasks" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith("08:30"));
    expect(await screen.findByText("Saved. It comes at 08:30 on days something is due.")).toBeTruthy();
    expect(screen.getByText(/Includes job titles and company names, never people or notes\./)).toBeTruthy();
  });

  it("sends a test on request", async () => {
    api.status.mockResolvedValue(status({ installed: true, settings: { time: "09:00" } }));
    api.test.mockResolvedValue({ ok: true });
    render(<DailySummary />);
    fireEvent.click(await screen.findByRole("button", { name: /Send a test now/ }));
    expect(await screen.findByText("Sent. Check Telegram.")).toBeTruthy();
    expect(api.test).toHaveBeenCalledOnce();
  });

  it("says what happened today", async () => {
    expect(dailyLine({ installed: true, last: { day: localDay(), at: at(9), result: "sent" } })).toBe("Last sent today at 9:00.");
    expect(dailyLine({ installed: true, last: { day: localDay(), at: at(9), result: "nothing-due" } })).toBe("Nothing was due today.");
    expect(dailyLine({ installed: true, last: { day: "2020-01-01", at: at(9), result: "sent" } })).toBe("Not sent yet today.");
    expect(dailyLine({ installed: false, last: null })).toBeUndefined();
    // Turned off: an earlier send isn't shown as if it were still running.
    expect(dailyLine({ installed: false, last: { day: localDay(), at: at(9), result: "sent" } })).toBeUndefined();
    api.status.mockResolvedValue(status({ installed: true, settings: { time: "09:00" }, last: { day: localDay(), at: at(9, 5), result: "sent" } }));
    render(<DailySummary />);
    expect(await screen.findByText("Last sent today at 9:05.")).toBeTruthy();
  });
});
