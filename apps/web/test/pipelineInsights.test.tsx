// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineInsights } from "../src/components/PipelineInsights";
import type { Entry } from "../src/lib/userState";

afterEach(cleanup);

const applied = (daysAgo: number): Entry => {
  const at = new Date(Date.now() - daysAgo * 864e5).toISOString();
  return { status: "applied", updatedAt: at, history: [{ status: "applied", at }], snapshot: { title: "PM", company: "Acme", url: "", location: "", score: 80 } };
};
const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`j${i}`, applied(i % 3)]));

describe("PipelineInsights", () => {
  it("shows the plan in the folded strip with a progress bar", () => {
    render(<PipelineInsights user={many(1)} plan={{ applications: 5 }} onPlan={() => {}} />);
    expect(screen.getByText(/1 of 5 applications · 0 follow-ups · 0 interviews coming up/)).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Applications this week" });
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
  });

  it("without a plan shows counts and a Set a plan button", () => {
    render(<PipelineInsights user={many(1)} plan={{}} onPlan={() => {}} />);
    expect(screen.getByRole("button", { name: "Set a plan" })).toBeTruthy();
    expect(screen.queryByText(/weeks in a row/)).toBeNull();
  });

  it("hides the funnel under 5 applications in 30 days", () => {
    const { unmount } = render(<PipelineInsights user={many(4)} plan={{}} onPlan={() => {}} />);
    expect(screen.getByText(/Shows once you have 5 applications/)).toBeTruthy();
    unmount();
    render(<PipelineInsights user={many(5)} plan={{}} onPlan={() => {}} />);
    expect(screen.getByText("Heard back")).toBeTruthy();
  });

  it("saves a goal from 1 to 50 and refuses others", () => {
    const onPlan = vi.fn();
    render(<PipelineInsights user={many(1)} plan={{ applications: 5 }} onPlan={onPlan} />);
    const field = screen.getByLabelText("Follow-ups") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "70" } });
    fireEvent.blur(field);
    expect(onPlan).not.toHaveBeenCalled();
    expect(screen.getByText("Enter 1 to 50, or leave it empty.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.blur(field);
    expect(onPlan).toHaveBeenCalledWith({ applications: 5, followUps: 3 });
  });

  it("refills a goal that arrives after the first render and keeps it on blur", () => {
    const onPlan = vi.fn();
    const { rerender } = render(<PipelineInsights user={many(1)} plan={{}} onPlan={onPlan} />);
    rerender(<PipelineInsights user={many(1)} plan={{ followUps: 4 }} onPlan={onPlan} />);
    const field = screen.getByLabelText("Follow-ups") as HTMLInputElement;
    expect(field.value).toBe("4");
    fireEvent.blur(field);
    expect(onPlan).not.toHaveBeenCalled();
  });

  it("refuses text a number field can't read instead of clearing the goal", () => {
    const onPlan = vi.fn();
    render(<PipelineInsights user={many(1)} plan={{ followUps: 4 }} onPlan={onPlan} />);
    const field = screen.getByLabelText("Follow-ups") as HTMLInputElement;
    Object.defineProperty(field, "validity", { value: { badInput: true } });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onPlan).not.toHaveBeenCalled();
    expect(screen.getByText("Enter 1 to 50, or leave it empty.")).toBeTruthy();
  });
});
