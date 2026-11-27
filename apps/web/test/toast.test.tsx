// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyPrompt } from "../src/components/ApplyPrompt";
import { Dialog } from "../src/components/Dialog";
import { dismissToast, pin, toast, Toaster } from "../src/components/Toast";
import { makeJob } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => {
    pin("apply", null);
    dismissToast(toast({ message: "" }));
    vi.runOnlyPendingTimers();
  });
  cleanup();
  vi.useRealTimers();
});

/** The page's host plus one Dialog, open until its Close button (or `open={false}`). */
function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Toaster />
      <Dialog
        open={open}
        label="Tracked job"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </Dialog>
    </>
  );
}

const regions = () => screen.getAllByRole("status", { hidden: true });
const toastRow = (text: string) => screen.getByText(text, { selector: "div" }).closest(".rj-toast") as HTMLElement;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("toasts and dialogs (U1)", () => {
  it("toast inside an open Dialog renders inside the dialog element", () => {
    render(<Page />);
    act(() => void toast({ message: "Removed Priya from this job", actionLabel: "Undo", onAction: () => {} }));
    const dialog = document.querySelector("dialog")!;
    expect(dialog.contains(screen.getByText("Removed Priya from this job"))).toBe(true);
    // The last child, so Tab reaches Undo inside the dialog's focus trap.
    expect(dialog.lastElementChild?.getAttribute("role")).toBe("status");
    expect(dialog.contains(screen.getByRole("button", { name: "Undo" }))).toBe(true);
  });

  it("toast moves to the page host when the dialog closes and keeps its remaining time", () => {
    render(<Page />);
    act(() => void toast({ message: "Saved", actionLabel: "Undo", onAction: () => {} }));
    advance(3000);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();
    // 8 s with an action: 5 s were left when it moved, not a fresh 8 s.
    advance(4900);
    expect(toastRow("Saved").dataset.state).toBeUndefined();
    advance(200);
    expect(toastRow("Saved").dataset.state).toBe("closing");
    advance(300);
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("only one role=status region has content", () => {
    render(<Page />);
    act(() => void toast({ message: "Copied the intro message" }));
    expect(regions()).toHaveLength(2);
    const filled = regions().filter((r) => r.textContent);
    expect(filled).toHaveLength(1);
    expect(document.querySelector("dialog")!.contains(filled[0]!)).toBe(true);
  });

  it("Escape in a toast does not close the dialog", () => {
    const onClose = vi.fn();
    const onPageKey = vi.fn();
    document.addEventListener("keydown", onPageKey);
    render(<Page onClose={onClose} />);
    act(() => void toast({ message: "Saved", actionLabel: "Undo", onAction: () => {} }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Undo" }), { key: "Escape" });
    document.removeEventListener("keydown", onPageKey);
    expect(toastRow("Saved").dataset.state).toBe("closing");
    expect(onClose).not.toHaveBeenCalled();
    expect(onPageKey).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("pinned apply prompt and a transient toast render in one column, pinned first", () => {
    const onAnswer = vi.fn();
    render(
      <>
        <Toaster />
        <ApplyPrompt job={makeJob({ title: "Head of Product", company: "Acme" })} onAnswer={onAnswer} />
      </>,
    );
    advance(2000);
    act(() => void window.dispatchEvent(new Event("focus")));
    act(() => void toast({ message: "Saved Head of Product, Acme" }));
    const [region, ...rest] = regions().filter((r) => r.textContent);
    expect(rest).toHaveLength(0);
    const rows = [...region!.children];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Did you apply to Head of Product at Acme?");
    expect(rows[1]!.textContent).toContain("Saved Head of Product, Acme");
    // The prompt has no live region of its own any more, and outlasts the toast.
    advance(10_000);
    expect(screen.getByText(/Did you apply to/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, mark applied" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("action toast defaults to 8000 ms", () => {
    render(<Toaster />);
    act(() => void toast({ message: "Hid Acme", actionLabel: "Undo", onAction: () => {} }));
    advance(7999);
    expect(toastRow("Hid Acme").dataset.state).toBeUndefined();
    advance(1);
    expect(toastRow("Hid Acme").dataset.state).toBe("closing");
    // Without an action it stays the old 5 s.
    act(() => void toast({ message: "Copied" }));
    advance(4999);
    expect(toastRow("Copied").dataset.state).toBeUndefined();
    advance(1);
    expect(toastRow("Copied").dataset.state).toBe("closing");
  });
});
