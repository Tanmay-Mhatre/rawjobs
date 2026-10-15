// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Chip, ChipGroup, Field, IconButton, Kbd, Menu, ScoreBadge, scoreBandOf, ScoreBreakdown, scoreParts, SearchField, SourceTag, Status, Tabs } from "../src/components/primitives";
import { dismissToast, toast, Toaster } from "../src/components/Toast";

afterEach(cleanup);

describe("Button", () => {
  it("is a button named by its label, with the shortcut announced as a key, not in the name", () => {
    render(
      <Button variant="primary" shortcut="R">
        Scan now
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Scan now" });
    expect(b.className).toBe("rj-btn rj-btn--primary");
    expect(b.getAttribute("aria-keyshortcuts")).toBe("R");
    expect(b.getAttribute("type")).toBe("button");
  });

  it("maps variants and sizes to the kit's classes, and disables", () => {
    render(
      <>
        <Button>Check this company</Button>
        <Button variant="quiet">Not interested</Button>
        <Button variant="danger" size="sm" disabled>
          Remove company
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Check this company" }).className).toBe("rj-btn");
    expect(screen.getByRole("button", { name: "Not interested" }).className).toBe("rj-btn rj-btn--quiet");
    const danger = screen.getByRole("button", { name: "Remove company" });
    expect(danger.className).toBe("rj-btn rj-btn--danger rj-btn--sm");
    expect((danger as HTMLButtonElement).disabled).toBe(true);
  });

  it("icon-only: named by aria-label, with a tooltip that names the shortcut", () => {
    render(
      <IconButton label="Copy job description" shortcut="C">
        <svg />
      </IconButton>,
    );
    const b = screen.getByRole("button", { name: "Copy job description" });
    expect(b.title).toBe("Copy job description (C)");
    expect(b.className).toContain("rj-btn--icon");
    expect(b.className).toContain("rj-btn--quiet");
  });
});

describe("Kbd", () => {
  it("is a <kbd>, hidden when it only decorates a labelled control", () => {
    const { container } = render(
      <>
        <Kbd>J</Kbd>
        <Kbd hidden>/</Kbd>
      </>,
    );
    const [shown, hidden] = container.querySelectorAll("kbd.rj-kbd");
    expect(shown!.textContent).toBe("J");
    expect(shown!.hasAttribute("aria-hidden")).toBe(false);
    expect(hidden!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Status", () => {
  it("shows shape, color and word: the word is the text, the glyph is hidden", () => {
    const { container } = render(
      <>
        <Status state="healthy" />
        <Status state="dormant" />
        <Status state="broken" />
      </>,
    );
    expect([...container.querySelectorAll(".rj-status__label")].map((e) => e.textContent)).toEqual(["Healthy", "Dormant", "Broken link"]);
    expect([...container.querySelectorAll(".rj-glyph")].map((e) => e.className)).toEqual(["rj-glyph rj-glyph--full", "rj-glyph rj-glyph--half", "rj-glyph rj-glyph--slash"]);
    expect(container.querySelector(".rj-glyph")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ScoreBadge", () => {
  it("bands: strong at or above the threshold, fair from 40, weak below", () => {
    expect([90, 70, 69, 40, 39, 0].map((s) => scoreBandOf(s, 70))).toEqual(["strong", "strong", "fair", "fair", "weak", "weak"]);
  });

  it("is an image that says the band, the score and whether it's estimated", () => {
    render(
      <>
        <ScoreBadge score={74} threshold={65} />
        <ScoreBadge score={56} threshold={65} estimated />
        <ScoreBadge score={23} size="lg" />
      </>,
    );
    const strong = screen.getByRole("img", { name: "Strong match, score 74" });
    expect(strong.className).toBe("rj-score rj-score--strong");
    expect(strong.textContent).toBe("74");
    const est = screen.getByRole("img", { name: "Fair match, score 56, estimated" });
    expect(est.className).toBe("rj-score rj-score--fair rj-score--estimated");
    expect(est.textContent).toBe("~56");
    expect(screen.getByRole("img", { name: "Weak match, score 23" }).className).toBe("rj-score rj-score--weak rj-score--lg");
  });
});

describe("ScoreBreakdown", () => {
  const why = { title: 30, location: 20, keywordPoints: 14, freshness: 10 };

  it("reads every value from the bar; the legend is hidden", () => {
    const { container } = render(<ScoreBreakdown score={74} parts={scoreParts(why)} found={["crypto", "exchange"]} missing={["payments"]} />);
    expect(screen.getByRole("img", { name: "Score 74: title 30 of 30, place 20 of 20, keywords 14 of 40, fresh 10 of 10" })).toBeTruthy();
    expect(container.querySelector(".rj-breakdown__legend")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".rj-breakdown__legend")!.textContent).toBe("Title 30/30Place 20/20Keywords 14/40Fresh 10/10");
    const fills = [...container.querySelectorAll<HTMLElement>(".rj-breakdown__seg > i")].map((i) => i.style.transform);
    expect(fills).toEqual(["scaleX(1)", "scaleX(1)", "scaleX(0.35)", "scaleX(1)"]);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["crypto", "exchange"]);
    expect(container.querySelector(".rj-breakdown__why")!.textContent).toBe("Keywords found: crypto exchange. Not found: payments.");
  });

  it("drops the keyword part when the score is scaled (no keywords set)", () => {
    render(<ScoreBreakdown score={80} parts={scoreParts({ ...why, keywordPoints: 0, scale: 1.67 })} />);
    expect(screen.getByRole("img", { name: "Score 80: title 30 of 30, place 20 of 20, fresh 10 of 10" })).toBeTruthy();
  });
});

describe("SourceTag", () => {
  it("names the source and age; the new dot has a name", () => {
    const { container } = render(<SourceTag source="Greenhouse" age="2d" isNew />);
    expect(screen.getByRole("img", { name: "New this scan" }).className).toBe("rj-dot");
    expect(container.textContent).toBe("Greenhouse2d");
  });
});

describe("Chip", () => {
  it("is a toggle button in a labelled group", async () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <ChipGroup label="Filters">
          <Chip pressed={on} count={12} onClick={() => setOn(!on)}>
            Strong matches
          </Chip>
        </ChipGroup>
      );
    }
    render(<Demo />);
    expect(screen.getByRole("group", { name: "Filters" })).toBeTruthy();
    const chip = screen.getByRole("button", { name: "Strong matches 12" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Tabs", () => {
  function Demo() {
    const [v, setV] = useState<"all" | "new" | "saved">("all");
    return (
      <Tabs
        label="Radar views"
        value={v}
        onChange={setV}
        items={[
          { id: "all", label: "All", count: 214 },
          { id: "new", label: "New", count: 9 },
          { id: "saved", label: "Saved" },
        ]}
      />
    );
  }

  it("is a labelled tablist with one selected tab in the tab order", () => {
    render(<Demo />);
    expect(screen.getByRole("tablist", { name: "Radar views" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]!.textContent).toBe("All214");
  });

  it("arrow keys, Home and End move focus and select; it wraps", async () => {
    render(<Demo />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /All/ }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /New/ }));
    expect(screen.getByRole("tab", { name: /New/ }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Saved" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /All/ }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowLeft}{Home}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /All/ }));
  });
});

describe("Field", () => {
  it("has a visible label and help that describes the input", () => {
    render(<Field label="Strong match threshold" help="Jobs scoring this or higher are marked strong." defaultValue="65" />);
    const input = screen.getByRole("textbox", { name: "Strong match threshold" });
    expect(input.className).toBe("rj-input");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById(input.getAttribute("aria-describedby")!)!.textContent).toBe("Jobs scoring this or higher are marked strong.");
  });

  it("an error marks the input invalid and replaces the help", () => {
    const { container } = render(<Field label="Careers page link" help="A link to the jobs page." error="This board returned no jobs. Check the link or try the company's main careers page." />);
    const input = screen.getByRole("textbox", { name: "Careers page link" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)!.className).toBe("rj-field__error");
    expect(container.querySelector(".rj-field__help")).toBeNull();
  });

  it("search: a searchbox with a hidden label and the / key", () => {
    const { container } = render(<SearchField label="Search jobs" placeholder="Search titles, companies, places" />);
    const box = screen.getByRole("searchbox", { name: "Search jobs" });
    expect(box.getAttribute("aria-keyshortcuts")).toBe("/");
    expect(container.querySelector("label")!.className).toBe("rj-sr");
    expect(container.querySelector(".rj-kbd")!.textContent).toBe("/");
  });
});

describe("Menu", () => {
  function Demo({ onSave = () => {} }: { onSave?: () => void }) {
    return (
      <>
        <Menu
          label="Job actions"
          trigger={(p) => (
            <button type="button" {...p}>
              More actions
            </button>
          )}
          items={[
            { id: "save", label: "Save", shortcut: "S", onSelect: onSave },
            { id: "applied", label: "Mark as applied", shortcut: "A", onSelect: () => {} },
            { separator: true, id: "sep" },
            { id: "hide", label: "Hide company", danger: true, onSelect: () => {} },
          ]}
        />
        <button type="button">Elsewhere</button>
      </>
    );
  }

  it("opens on Enter and focuses the first item; arrows, Home and End move real focus", async () => {
    render(<Demo />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu", { name: "Job actions" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["SaveS", "Mark as appliedA", "Hide company"]);
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    expect(items.map((i) => i.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(items[2]);
    expect(items[2]!.className).toContain("rj-menu__item--danger");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("Esc closes and returns focus to the trigger", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Demo />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const trigger = screen.getByRole("button", { name: "More actions" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // It plays its exit (data-state="closing"), then goes.
    expect(screen.getByRole("menu").getAttribute("data-state")).toBe("closing");
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByRole("menu")).toBeNull();
    vi.useRealTimers();
  });

  it("choosing an item runs it and closes", async () => {
    const onSave = vi.fn();
    render(<Demo onSave={onSave} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "More actions" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Toast", () => {
  it("one at a time, inside a polite live region, with Undo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Toaster />);
    const undo = vi.fn();
    act(() => void toast({ message: "Saved Head of Product, Exchange", actionLabel: "Undo", onAction: undo }));
    act(() => void toast({ message: "Saved Senior PM, Payments", actionLabel: "Undo", onAction: undo }));
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.querySelectorAll(".rj-toast")).toHaveLength(1);
    expect(region.textContent).toContain("Saved Senior PM, Payments");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(region.querySelector(".rj-toast")!.getAttribute("data-state")).toBe("closing");
    act(() => void vi.advanceTimersByTime(300));
    expect(region.querySelector(".rj-toast")).toBeNull();
    vi.useRealTimers();
  });

  it("goes after 5 seconds", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    let id = 0;
    act(() => void (id = toast({ message: "Copied the description" })));
    act(() => void vi.advanceTimersByTime(4900));
    expect(screen.getByRole("status").textContent).toContain("Copied");
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status").querySelector(".rj-toast")!.getAttribute("data-state")).toBe("closing");
    // Then its exit animation, and it's gone.
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByRole("status").querySelector(".rj-toast")).toBeNull();
    dismissToast(id);
    vi.useRealTimers();
  });
});
