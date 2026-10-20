// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardChip, closedHint, Pipeline, sortCards } from "../src/components/Pipeline";
import type { Job } from "../src/lib/data";
import { cardState, nextSteps } from "../src/lib/nextSteps";
import type { Entry, Status, UserState } from "../src/lib/userState";
import { makeJob } from "./helpers";

afterEach(cleanup);

const now = new Date("2026-10-20T15:00:00");
const noon = (day: string) => new Date(`${day}T12:00:00`).toISOString();

/** A tracked job in `status` since `since`, with any other fields. */
const entry = (status: Status, since: string, o: Partial<Entry> = {}): Entry => ({
  status,
  updatedAt: noon(since),
  history: [{ status, at: noon(since) }],
  snapshot: { title: o.snapshot?.title ?? `Job ${status} ${since}`, company: "Acme", url: "", location: "Dubai", score: 80 },
  ...o,
});

const chipOf = (e: Entry) => {
  const tasks = nextSteps({ x: e }, now).get("x") ?? [];
  return cardChip(e, cardState(e, tasks, now), now)?.text;
};

describe("card chips (section 6.1, 9.2.19)", () => {
  it("says what's next in words for every state", () => {
    expect(chipOf(entry("applied", "2026-10-10", { followUp: "2026-10-17" }))).toBe("Follow up · 3d overdue");
    expect(chipOf(entry("applied", "2026-10-10", { followUp: "2026-10-20" }))).toBe("Follow up today");
    expect(chipOf(entry("applied", "2026-10-10", { followUp: "2026-10-28" }))).toMatch(/^Follow up (Oct 28|28 Oct)$/);
    expect(chipOf(entry("saved", "2026-10-10", { followUp: "2026-10-28" }))).toMatch(/^Apply by (Oct 28|28 Oct)$/);
    expect(chipOf(entry("applied", "2026-09-20"))).toBe("No reply · 30d");
    expect(chipOf(entry("interviewing", "2026-10-10"))).toBe("No next step");
    expect(chipOf(entry("rejected", "2026-10-10", { closedAs: "no-response" }))).toBeUndefined();
  });
});

describe("sortCards", () => {
  it("puts overdue first, then the soonest next step, then the longest in the stage", () => {
    const items: [string, Entry][] = [
      ["new", entry("applied", "2026-10-18")],
      ["old", entry("applied", "2026-10-01", { followUp: "2026-12-01" })],
      ["soon", entry("applied", "2026-10-15", { followUp: "2026-10-22" })],
      ["late", entry("applied", "2026-10-12", { followUp: "2026-10-18" })],
      ["older", entry("applied", "2026-10-16")],
    ];
    const state = Object.fromEntries(items);
    expect(sortCards(items, nextSteps(state, now), now).map(([id]) => id)).toEqual(["late", "soon", "old", "older", "new"]);
  });

  it("shows the most recently closed first, and counts each outcome", () => {
    const items: [string, Entry][] = [
      ["a", entry("rejected", "2026-10-01")],
      ["b", entry("rejected", "2026-10-15", { closedAs: "no-response" })],
      ["c", entry("rejected", "2026-10-10", { closedAs: "no-response" })],
    ];
    expect(sortCards(items, new Map(), now).map(([id]) => id)).toEqual(["b", "c", "a"]);
    expect(closedHint(items)).toBe("1 closed, 2 no response");
  });
});

function renderBoard(o: { user?: UserState; onPatch?: ReturnType<typeof vi.fn>; goRadar?: () => void } = {}) {
  return render(
    <Pipeline user={o.user ?? {}} jobsById={new Map()} onOpen={() => {}} onPatch={o.onPatch ?? vi.fn()} onAdd={() => {}} onWeeklyPlan={() => {}} goRadar={o.goRadar ?? (() => {})} now={now} />,
  );
}

describe("To review column", () => {
  it("stays hidden until the apply kit has answers to review", () => {
    renderBoard({ user: { a: entry("saved", "2026-10-10") } });
    expect(screen.queryByRole("heading", { name: /^To review/ })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).some((h) => /^Saved/.test(h.textContent ?? ""))).toBe(true);
  });
});

describe("Next steps (9.2.18)", () => {
  it("logs a follow-up from the pop-over, marked as a follow-up", () => {
    const onPatch = vi.fn();
    const e = entry("applied", "2026-10-01", {
      followUp: "2026-10-18",
      snapshot: { title: "Data Lead", company: "Acme", url: "", location: "", score: 80 },
      contacts: [{ id: "p1", name: "Priya Shah" }],
      activities: [{ id: "a1", at: noon("2026-10-11"), channel: "linkedin", dir: "sent", contactId: "p1" }],
    });
    renderBoard({ user: { a: e }, onPatch });
    expect(screen.getByRole("heading", { name: /^Overdue/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log follow-up" }));
    const dialog = screen.getByRole("dialog", { name: "Log follow-up" });
    expect((within(dialog).getByLabelText("What was said") as HTMLTextAreaElement).value).toMatch(/^Hi Priya, I applied for the Data Lead role/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Log LinkedIn message" }));
    const [id, , patch] = onPatch.mock.calls[0]!;
    expect(id).toBe("a");
    expect(patch.activities.at(-1)).toMatchObject({ channel: "linkedin", dir: "sent", contactId: "p1", followUp: true });
  });

  it("snoozes a follow-up, and closes a quiet application or follows up once more", () => {
    const onPatch = vi.fn();
    renderBoard({ user: { f: entry("applied", "2026-10-10", { followUp: "2026-10-19" }), q: entry("applied", "2026-09-20") }, onPatch });
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));
    expect(onPatch).toHaveBeenLastCalledWith("f", expect.anything(), { followUp: "2026-10-21" });
    fireEvent.click(screen.getByRole("button", { name: "Follow up once more" }));
    expect(onPatch).toHaveBeenLastCalledWith("q", expect.anything(), { followUp: "2026-10-27", skipped: ["close:0"] });
    fireEvent.click(screen.getByRole("button", { name: "Close as no response" }));
    expect(onPatch).toHaveBeenLastCalledWith("q", expect.anything(), { status: "rejected", closedAs: "no-response" });
  });

  it("gives a Saved job's Apply by date Open, Snooze and Mark done, not Log follow-up", () => {
    renderBoard({ user: { s: entry("saved", "2026-10-10", { followUp: "2026-10-19" }) } });
    const steps = screen.getByRole("region", { name: "Next steps" });
    expect(within(steps).queryByRole("button", { name: "Log follow-up" })).toBeNull();
    for (const name of ["Open", "Snooze", "Mark done"]) expect(within(steps).getByRole("button", { name: new RegExp(name) })).toBeTruthy();
  });

  it("moves focus to the next row when a row is marked done", async () => {
    function Harness() {
      const [user, setUser] = useState<UserState>({
        t: entry("interviewing", "2026-10-01", { interviews: [{ on: "2026-10-18", what: "Panel" }] }),
        f: entry("applied", "2026-10-10", { followUp: "2026-10-19", snapshot: { title: "Next one", company: "Acme", url: "", location: "", score: 80 } }),
      });
      return (
        <Pipeline
          user={user}
          jobsById={new Map()}
          onOpen={() => {}}
          onPatch={(id, e, patch) => setUser((u) => ({ ...u, [id]: { ...e, ...patch } }))}
          onAdd={() => {}}
          onWeeklyPlan={() => {}}
          goRadar={() => {}}
          now={now}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement?.textContent).toBe("Next one");
  });

  it("says Nothing due. when nothing is", () => {
    renderBoard({ user: { a: entry("interviewing", "2026-10-15") } });
    expect(screen.getByText("Nothing due.")).toBeTruthy();
  });
});

describe("moving to Closed", () => {
  it("asks how it ended", () => {
    const onPatch = vi.fn();
    const e = entry("applied", "2026-10-15", { snapshot: { title: "Ops Lead", company: "Acme", url: "", location: "", score: 80 } });
    renderBoard({ user: { a: e }, onPatch });
    fireEvent.click(screen.getByRole("button", { name: "Move Ops Lead to" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Closed" }));
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog", { name: "How did it end?" })).getByRole("button", { name: "I withdrew" }));
    expect(onPatch).toHaveBeenCalledWith("a", e, { status: "rejected", closedAs: "withdrew" });
  });
});
