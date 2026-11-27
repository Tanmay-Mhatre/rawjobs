// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField, fieldTime, parseTime, TimeField } from "../src/components/DateField";

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

  it("input has role combobox and aria-expanded", () => {
    render(<TimeField label="Time" value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Time" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    fireEvent.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Time" });
    expect(list.tagName).toBe("UL");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(within(list).getAllByRole("option")[0]!.tagName).toBe("LI");
  });

  it("ArrowDown sets aria-activedescendant and keeps focus on input", () => {
    render(<TimeField label="Time" value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Time" });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const first = input.getAttribute("aria-activedescendant");
    expect(document.getElementById(first!)?.textContent).toBe(fieldTime("09:00"));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent).toBe(fieldTime("09:15"));
    expect(document.activeElement).toBe(input);
  });

  it("Enter commits", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TimeField label="Time" value="" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Time" });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("08:45");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    // A typed time that isn't on the list commits as typed.
    rerender(<TimeField label="Time" value="08:45" onChange={onChange} />);
    fireEvent.change(input, { target: { value: "10:10" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("10:10");
  });

  it("Escape closes and focus stays in input; wrapper matches :focus-within", () => {
    const onDialogKey = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the dialog around the field
      <div onKeyDown={(e) => onDialogKey(e.key)}>
        <TimeField label="Time" value="" onChange={() => {}} />
      </div>,
    );
    const input = screen.getByRole("combobox", { name: "Time" });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onDialogKey).not.toHaveBeenCalledWith("Escape");
    expect(document.activeElement).toBe(input);
    const wrapper = input.parentElement!;
    // happy-dom has no :focus-within; this is what it matches.
    expect(wrapper.contains(document.activeElement)).toBe(true);
    expect(wrapper.className).toContain("focus-within:outline-[var(--focus-ring)]");
    // With the list closed, the next Escape reaches the dialog.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onDialogKey).toHaveBeenCalledWith("Escape");
  });

  it("Alt+ArrowDown opens without changing value", () => {
    const onChange = vi.fn();
    render(<TimeField label="Time" value="14:30" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Time" }) as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(input.value).toBe(fieldTime("14:30"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
