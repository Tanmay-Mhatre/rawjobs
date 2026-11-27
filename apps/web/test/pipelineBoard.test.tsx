// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardChip, closedHint, Pipeline, sortCards } from "../src/components/Pipeline";
import { dismissToast, toast, Toaster } from "../src/components/Toast";
import type { Job } from "../src/lib/data";
import { cardState, nextSteps } from "../src/lib/nextSteps";
import { applyPatch, type Entry, type Status, stageSince, type UserState } from "../src/lib/userState";
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
    // No date: a follow-up a week after the move, and a Reply when they wrote last.
    expect(chipOf(entry("interviewing", "2026-10-10"))).toBe("Follow up · 3d overdue");
    const wrote = { id: "r", at: noon("2026-10-19"), channel: "whatsapp" as const, dir: "received" as const };
    expect(chipOf(entry("interviewing", "2026-10-10", { activities: [wrote] }))).toBe("Reply · 1d overdue");
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

  it("doesn't offer Accepted the offer for a job that never reached Offer", () => {
    renderBoard({ user: { a: entry("applied", "2026-10-15", { snapshot: { title: "Ops Lead", company: "Acme", url: "", location: "", score: 80 } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Move Ops Lead to" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Closed" }));
    expect(within(screen.getByRole("dialog", { name: "How did it end?" })).queryByRole("button", { name: /accepted/i })).toBeNull();
  });

  it("offers Accepted the offer as a quiet link for a job that reached Offer", () => {
    const onPatch = vi.fn();
    const offered = entry("offer", "2026-10-15", { snapshot: { title: "Ops Lead", company: "Acme", url: "", location: "", score: 80 } });
    renderBoard({ user: { a: offered }, onPatch });
    fireEvent.click(screen.getByRole("button", { name: "Move Ops Lead to" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Closed" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "How did it end?" })).getByRole("button", { name: "Accepted the offer?" }));
    expect(onPatch).toHaveBeenCalledWith("a", offered, { status: "rejected", closedAs: "accepted" });
  });

  it("shows Accepted the offer on a closed card", () => {
    renderBoard({ user: { a: entry("rejected", "2026-10-15", { closedAs: "accepted" }) } });
    expect(screen.getAllByText("Accepted the offer").length).toBeGreaterThan(0);
  });
});

describe("a Radar job opened from the board", () => {
  it("opens the wide dialog with the job's summary, Apply while saved, and Open full job", () => {
    const job: Job = makeJob({ id: "greenhouse:acme:9", salary: { min: 40000, max: 50000, currency: "AED", period: "month" } });
    const onOpen = vi.fn();
    const onApply = vi.fn();
    render(
      <Pipeline
        user={{ [job.id]: entry("saved", "2026-10-18", { snapshot: { title: job.title, company: "Acme", url: job.url, location: "Dubai", score: 75 } }) }}
        jobsById={new Map([[job.id, job]])}
        onOpen={onOpen}
        onApply={onApply}
        minScore={60}
        onPatch={vi.fn()}
        onAdd={() => {}}
        onWeeklyPlan={() => {}}
        goRadar={() => {}}
        now={now}
      />,
    );
    // The card's title (Next steps above the board names the job too).
    fireEvent.click(screen.getAllByRole("button", { name: job.title }).at(-1)!);
    expect(onOpen).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog", { name: job.title }));
    expect(dialog.getByText(/^AED 40K/)).toBeTruthy();
    expect(dialog.getByText("Found on your Radar")).toBeTruthy();
    fireEvent.click(dialog.getByRole("link", { name: "Apply at Acme" }));
    expect(onApply).toHaveBeenCalledWith(job);
    fireEvent.click(dialog.getByRole("button", { name: "Open full job" }));
    expect(onOpen).toHaveBeenCalledWith(job);
    expect(screen.queryByRole("dialog", { name: job.title })).toBeNull();
  });

  it("leaves out Apply once you've applied, and a hand-added job gets no summary", () => {
    const job = makeJob({ id: "greenhouse:acme:10" });
    render(
      <Pipeline
        user={{
          [job.id]: entry("applied", "2026-10-18", { snapshot: { title: job.title, company: "Acme", url: job.url, location: "Dubai", score: 75 } }),
          "manual:x": entry("saved", "2026-10-18", { snapshot: { title: "By hand", company: "Initech", url: "", location: "", score: 0 } }),
        }}
        jobsById={new Map([[job.id, job]])}
        onOpen={() => {}}
        onPatch={vi.fn()}
        onAdd={() => {}}
        onWeeklyPlan={() => {}}
        goRadar={() => {}}
        now={now}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: job.title }).at(-1)!);
    expect(screen.queryByRole("link", { name: /^Apply at/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Open full job" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getAllByRole("button", { name: "By hand" }).at(-1)!);
    expect(screen.queryByRole("button", { name: "Open full job" })).toBeNull();
  });
});

describe("removing from the Pipeline (U2)", () => {
  afterEach(() => {
    act(() => {
      dismissToast(toast({ message: "" }));
    });
  });

  /** The board on real tracking rules: patches go through applyPatch, Undo and Delete through restore. */
  function live(initial: UserState) {
    const state = { current: initial };
    function Harness() {
      const [user, setUser] = useState(initial);
      state.current = user;
      const write = (id: string, e: Entry | null) =>
        setUser((u) => {
          const { [id]: _, ...rest } = u;
          return e ? { ...rest, [id]: e } : rest;
        });
      return (
        <>
          <Toaster />
          <Pipeline
            user={user}
            jobsById={new Map()}
            onOpen={() => {}}
            onPatch={(id, e, patch) => write(id, applyPatch(state.current[id], { id, ...e.snapshot }, patch, now.toISOString()))}
            onRestore={write}
            onAdd={() => {}}
            onWeeklyPlan={() => {}}
            goRadar={() => {}}
            now={now}
          />
        </>
      );
    }
    render(<Harness />);
    return state;
  }
  const named = (title: string) => ({ snapshot: { title, company: "Acme", url: "", location: "Dubai", score: 80 } });
  const removeViaMenu = (title: string) => {
    fireEvent.click(screen.getByRole("button", { name: `Move ${title} to` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from Pipeline" }));
  };
  const card = (title: string) => screen.queryAllByRole("button", { name: title }).find((b) => b.hasAttribute("data-card-title"));

  it("Remove from Pipeline via menu shows toast with Undo; Undo puts the card back in the same column with the same stageSince", () => {
    const before = entry("interviewing", "2026-10-05", named("Head of Product"));
    const state = live({ a: before, b: entry("saved", "2026-10-10") });
    removeViaMenu("Head of Product");
    expect(card("Head of Product")).toBeUndefined();
    expect(screen.getByText(/ from the Pipeline$/).textContent).toBe("Removed Head of Product from the Pipeline");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(state.current.a).toEqual(before);
    expect(stageSince(state.current.a!)).toBe(stageSince(before));
    const column = card("Head of Product")!.closest("section")!;
    expect(within(column).getByRole("heading").textContent).toMatch(/^Interviewing/);
    expect(screen.getByText("Back on the Pipeline in Interviewing.")).toBeTruthy();
  });

  it("remove from the TrackedJob select: Undo is inside the dialog and clickable", () => {
    const before = entry("applied", "2026-10-10", named("Data Lead"));
    const state = live({ a: before, b: entry("saved", "2026-10-10") });
    fireEvent.click(card("Data Lead")!);
    const dialog = screen.getByRole("dialog", { name: "Data Lead" });
    fireEvent.change(within(dialog).getByLabelText("Stage"), { target: { value: "" } });
    expect(state.current.a!.status).toBeUndefined();
    // The dialog stays open on the job, and its toast is inside it (not behind the modal).
    expect(dialog.isConnected).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    expect(state.current.a).toEqual(before);
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Stage").value).toBe("applied");
  });

  it("manual job removed appears under Removed (1); Put back restores its stage", () => {
    const state = live({ "manual:x": entry("applied", "2026-10-02", named("By hand")), b: entry("saved", "2026-10-10") });
    expect(screen.queryByRole("button", { name: /^Removed \(/ })).toBeNull();
    removeViaMenu("By hand");
    fireEvent.click(screen.getByRole("button", { name: "Removed (1)" }));
    const drawer = within(screen.getByRole("dialog", { name: "Removed from the Pipeline" }));
    expect(drawer.getByText(/^Was Applied · removed/)).toBeTruthy();
    fireEvent.click(drawer.getByRole("button", { name: "Put back By hand" }));
    expect(state.current["manual:x"]!.status).toBe("applied");
    // Days in the stage count from the day it got there, not from Put back.
    expect(stageSince(state.current["manual:x"]!).slice(0, 10)).toBe(noon("2026-10-02").slice(0, 10));
    expect(drawer.getByText("Nothing removed. Jobs you take off the board show up here.")).toBeTruthy();
    expect(screen.getByText("Put By hand back in Applied")).toBeTruthy();
  });

  it("Delete asks inline, Keep it has focus, Escape keeps it, Delete for good deletes", () => {
    const state = live({ a: entry("saved", "2026-10-02", named("Ops Manager")), b: entry("saved", "2026-10-10") });
    removeViaMenu("Ops Manager");
    fireEvent.click(screen.getByRole("button", { name: "Removed (1)" }));
    const dialog = screen.getByRole("dialog", { name: "Removed from the Pipeline" });
    const drawer = within(dialog);
    fireEvent.click(drawer.getByRole("button", { name: "Delete Ops Manager" }));
    expect(drawer.getByText("Delete Ops Manager and its history for good?")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Keep it");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(drawer.queryByText(/for good\?$/)).toBeNull();
    expect(screen.getByRole("dialog", { name: "Removed from the Pipeline" })).toBe(dialog);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete Ops Manager");
    expect(state.current).toHaveProperty("a");
    fireEvent.click(drawer.getByRole("button", { name: "Delete Ops Manager" }));
    fireEvent.click(drawer.getByRole("button", { name: "Delete for good" }));
    expect(state.current).not.toHaveProperty("a");
    expect(screen.getByText("Deleted Ops Manager")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("focus moves to the next card after remove", () => {
    live({ a: entry("applied", "2026-10-02", named("First")), b: entry("applied", "2026-10-05", named("Second")) });
    removeViaMenu("First");
    expect(document.activeElement).toBe(card("Second"));
  });
});
