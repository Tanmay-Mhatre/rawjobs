// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerDownWindow } from "../src/components/ServerDown";
import type { ServerHealth } from "../src/lib/update";

const openStartLink = vi.fn();
vi.mock("../src/lib/update", () => ({ openStartLink: () => openStartLink() }));

beforeEach(() => {
  vi.useFakeTimers();
  openStartLink.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const health = (h: Partial<ServerHealth> = {}): ServerHealth => ({ down: true, since: 0, startLink: true, platform: "win32", setFast: () => {}, ...h });

describe("ServerDownWindow", () => {
  it("with the Start link: one button, and no Desktop instructions next to it", () => {
    render(<ServerDownWindow health={health()} />);
    expect(screen.getByRole("heading", { name: "RawJobs isn't running" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start RawJobs/ })).toBeTruthy();
    expect(screen.queryByText(/Double-click RawJobs/)).toBeNull();
  });

  it("offers the Desktop shortcut only after the button didn't bring it back", () => {
    render(<ServerDownWindow health={health()} />);
    fireEvent.click(screen.getByRole("button", { name: /Start RawJobs/ }));
    expect(openStartLink).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Starting RawJobs…" })).toBeTruthy();
    expect(screen.queryByText(/Double-click RawJobs/)).toBeNull();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("heading", { name: "RawJobs still isn't running" })).toBeTruthy();
    expect(screen.getByText(/Double-click RawJobs on your Desktop instead/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("without the Start link: no button, the Desktop shortcut in the computer's words", () => {
    render(<ServerDownWindow health={health({ startLink: false, platform: "darwin" })} />);
    expect(screen.queryByRole("button", { name: /Start RawJobs/ })).toBeNull();
    expect(screen.getByText(/Double-click RawJobs on your Desktop to start it\. Or open it from Applications\./)).toBeTruthy();
  });

  it("says it's back, then reloads the page", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...location, reload });
    const { rerender } = render(<ServerDownWindow health={health()} />);
    rerender(<ServerDownWindow health={health({ down: false, since: null })} />);
    expect(screen.getByRole("heading", { name: "RawJobs is back" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1000));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
