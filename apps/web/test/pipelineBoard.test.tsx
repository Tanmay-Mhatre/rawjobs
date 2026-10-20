// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function renderBoard(o: { user?: UserState; review?: { jobs: Job[]; total: number }; onPatch?: ReturnType<typeof vi.fn>; onReview?: ReturnType<typeof vi.fn>; goRadar?: () => void } = {}) {
  return render(
    <Pipeline
      user={o.user ?? {}}
      jobsById={new Map()}
      onOpen={() => {}}
      onPatch={o.onPatch ?? vi.fn()}
      onAdd={() => {}}
      onWeeklyPlan={() => {}}
      goRadar={o.goRadar ?? (() => {})}
      review={o.review}
      onReview={o.onReview}
      now={now}
    />,
  );
}

describe("To review column (9.2.17)", () => {
  it("lists strong matches with Save, Not interested and a link to the rest on the Radar", () => {
    const j = makeJob({ title: "Head of Product", firstSeen: new Date(now.getTime() - 2 * 864e5).toISOString() });
    const onReview = vi.fn();
    const goRadar = vi.fn();
    renderBoard({ review: { jobs: [j], total: 15 }, onReview, goRadar });
    const col = screen.getByRole("heading", { name: /^To review/ }).closest("section")!;
    expect(within(col).getByText("Head of Product")).toBeTruthy();
    expect(within(col).getByText(/^Strong match · found/)).toBeTruthy();
    fireEvent.click(within(col).getByRole("button", { name: "Save" }));
    fireEvent.click(within(col).getByRole("button", { name: "Not interested" }));
    expect(onReview.mock.calls).toEqual([
      [j, "saved"],
      [j, "dismissed"],
    ]);
    fireEvent.click(within(col).getByRole("button", { name: "See all 15 on the Radar" }));
    expect(goRadar).toHaveBeenCalled();
  });

  it("says so when there's nothing new, and is hidden while the Radar isn't set up", () => {
    const user = { a: entry("saved", "2026-10-10") };
    renderBoard({ user, review: { jobs: [], total: 0 } });
    expect(screen.getByText("No new strong matches.")).toBeTruthy();
    cleanup();
    renderBoard({ user });
    expect(screen.queryByRole("heading", { name: /^To review/ })).toBeNull();
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
