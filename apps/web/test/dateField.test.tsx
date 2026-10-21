// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField, parseTime, TimeField } from "../src/components/DateField";

afterEach(cleanup);

const name = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

describe("DateField", () => {
  it("opens from a press on the field and moves with the keyboard, a week or a month at a time", () => {
    const onChange = vi.fn();
    render(<DateField label="Follow up on" value="2026-10-28" onChange={onChange} />);
    const field = screen.getByRole("button", { name: name("2026-10-28") });
    fireEvent.click(field);
    expect(field.getAttribute("aria-expanded")).toBe("true");
    const cal = within(screen.getByRole("dialog", { name: "Follow up on" }));
    fireEvent.keyDown(cal.getByRole("button", { name: name("2026-10-28") }), { key: "ArrowDown" });
    fireEvent.keyDown(cal.getByRole("button", { name: name("2026-11-04") }), { key: "PageUp" });
    fireEvent.keyDown(cal.getByRole("button", { name: name("2026-10-04") }), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2026-10-04");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("won't pick a day outside min and max, and Escape closes it", () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="2026-10-20" min="2026-10-15" max="2026-10-20" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: name("2026-10-20") }));
    const cal = within(screen.getByRole("dialog", { name: "Date" }));
    fireEvent.click(cal.getByRole("button", { name: name("2026-10-21") }));
    fireEvent.click(cal.getByRole("button", { name: name("2026-10-14") }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(cal.getByRole("button", { name: name("2026-10-20") }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TimeField", () => {
  it("reads typed times in either clock, and picks from the list", () => {
    expect(parseTime("14:30")).toBe("14:30");
    expect(parseTime("2:30 pm")).toBe("14:30");
    expect(parseTime("12am")).toBe("00:00");
    expect(parseTime("930")).toBe("09:30");
    expect(parseTime("25:00")).toBeUndefined();
    expect(parseTime("soon")).toBeUndefined();
    const onChange = vi.fn();
    render(<TimeField label="Time" value="" onChange={onChange} />);
    fireEvent.focus(screen.getByLabelText("Time"));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Time" })).getAllByRole("option")[8]!);
    expect(onChange).toHaveBeenCalledWith("09:00");
  });
});
