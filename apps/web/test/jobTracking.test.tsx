// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/Toast", () => ({ toast: vi.fn() }));
import { contactText, filterTimeline, knownPeople, pasteField, timeline, touchLine } from "../src/components/pipeline/detail";
import { JobTracking } from "../src/components/pipeline/JobTracking";
import { PeopleProvider } from "../src/components/pipeline/PeopleContext";
import { toast } from "../src/components/Toast";
import { TrackedJobDialog } from "../src/components/TrackedJob";
import { addActivity, applyPatch, type Entry, type EntryPatch, type UserState } from "../src/lib/userState";

afterEach(cleanup);

const now = new Date("2026-10-20T15:00:00");
const snapshot = { title: "Product manager", company: "Acme", url: "https://acme.test/1", location: "Dubai", score: 80 };
const entry = (over: Partial<Entry> = {}): Entry => ({
  status: "applied",
  updatedAt: "2026-10-15T09:00:00.000Z",
  history: [
    { status: "saved", at: "2026-10-10T09:00:00.000Z" },
    { status: "applied", at: "2026-10-12T09:00:00.000Z" },
  ],
  snapshot,
  ...over,
});

const priya = {
  id: "p1",
  name: "Priya Shah",
  role: "recruiter" as const,
  company: "Acme",
  email: "priya@acme.test",
  phone: "+971 50 123 4567",
  whatsapp: true,
  linkedin: "https://www.linkedin.com/in/priya",
};

/** JobTracking over a real entry: each patch goes through applyPatch, as the app does. */
function Harness({ start, onPatch }: { start: Entry; onPatch?: (p: EntryPatch) => void }) {
  const [e, setE] = useState<Entry>(start);
  return (
    <JobTracking
      jobId="job1"
      entry={e}
      title="Product manager"
      foundAt="2026-10-09T08:00:00.000Z"
      now={now}
      onUpdate={(p) => {
        onPatch?.(p);
        setE((prev) => applyPatch(prev, { id: "job1", ...snapshot }, p, now.toISOString()) ?? prev);
      }}
    />
  );
}

describe("timeline", () => {
  it("lists touches, notes, stages and the Radar find newest first, with the v1 note as a note row", () => {
    const e = entry({
      note: "Met at the meetup",
      activities: [{ id: "a1", at: "2026-10-14T10:00:00.000Z", channel: "email", dir: "sent", contactId: "p1" }],
      contacts: [priya],
    });
    const items = timeline(e, "2026-10-09T08:00:00.000Z");
    expect(items.map((i) => i.kind)).toEqual(["note", "touch", "stage", "stage", "found"]);
    expect(items[1]).toMatchObject({ title: "Emailed Priya Shah" });
    expect(items[2]).toMatchObject({ text: "Moved to Applied" });
    expect(filterTimeline(items, "messages").map((i) => i.kind)).toEqual(["touch"]);
    expect(filterTimeline(items, "changes")).toEqual([]);
    expect(filterTimeline(items, "notes")).toHaveLength(1);
  });

  it("shows how a closed job ended on its last stage row", () => {
    const e = entry({ status: "rejected", closedAs: "no-response", history: [{ status: "rejected", at: "2026-10-12T09:00:00.000Z" }] });
    expect(timeline(e)[0]).toMatchObject({ text: "Moved to No response" });
  });
});

describe("people helpers", () => {
  it("puts a pasted LinkedIn URL, email or phone in its own field, and leaves other text alone", () => {
    expect(pasteField("https://www.linkedin.com/in/priya")).toEqual({ field: "linkedin", value: "https://www.linkedin.com/in/priya" });
    expect(pasteField("linkedin.com/in/priya")?.field).toBe("linkedin");
    expect(pasteField("mailto:priya@acme.test")).toEqual({ field: "email", value: "priya@acme.test" });
    expect(pasteField("+971 (50) 123-4567")?.field).toBe("phone");
    expect(pasteField("Priya Shah")).toBeUndefined();
    expect(pasteField("https://evil.test/linkedin.com/in/x")).toBeUndefined();
    expect(pasteField("12345")).toBeUndefined();
  });

  it("offers people from other jobs once each, not the ones already here", () => {
    const state: UserState = {
      job1: entry({ contacts: [priya] }),
      job2: entry({ contacts: [priya, { id: "p2", name: "Omar" }] }),
      job3: entry({
        contacts: [
          { id: "p2", name: "Omar" },
          { id: "p3", name: "Ana" },
        ],
      }),
    };
    expect(knownPeople(state, "job1").map((c) => c.id)).toEqual(["p3", "p2"]);
  });

  it("says when you were last in touch and how often, and copies the details", () => {
    const e = entry({
      activities: [
        { id: "a1", at: "2026-10-14T10:00:00.000Z", channel: "email", dir: "sent", contactId: "p1" },
        { id: "a2", at: "2026-10-16T10:00:00.000Z", channel: "whatsapp", dir: "received", contactId: "p1" },
        { id: "a3", at: "2026-10-17T10:00:00.000Z", channel: "note", contactId: "p1" },
      ],
    });
    expect(touchLine(e, "p1", () => "4 days ago")).toBe("Last: WhatsApp, 4 days ago · 2 touches");
    expect(touchLine(e, "p9", () => "")).toBe("No touches yet");
    expect(contactText(priya)).toBe("Priya Shah, Recruiter, Acme\npriya@acme.test\n+971 50 123 4567\nhttps://www.linkedin.com/in/priya");
    expect(contactText({ id: "x", name: "Omar" })).toBe("Omar");
  });
});

describe("JobTracking", () => {
  it("logs a sent email from the Activity tab: saved with a follow-up, announced, and shown in the timeline", async () => {
    const onPatch = vi.fn();
    render(<Harness start={entry()} onPatch={onPatch} />);
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    // One line until you use it.
    expect(screen.queryByLabelText("What was said")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log a message, call or note…" }));
    fireEvent.change(screen.getByLabelText("What was said"), { target: { value: "Sent my portfolio" } });
    fireEvent.click(screen.getByRole("button", { name: "Log email" }));
    expect(onPatch.mock.calls[0]![0]).toMatchObject({ followUp: "2026-10-27", activities: [{ channel: "email", dir: "sent", text: "Sent my portfolio" }] });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^Logged email\. Next follow-up/));
    const history = screen.getByRole("list", { name: "History" });
    expect(history.tagName).toBe("OL");
    expect(within(history).getByText("Sent my portfolio")).toBeTruthy();
    expect(history.querySelector("time")?.getAttribute("dateTime")).toBe(now.toISOString());
    expect(within(history).getByText("Found on your Radar")).toBeTruthy();
  });

  it("filters the timeline with pressed chips", () => {
    render(<Harness start={entry({ note: "Old note" })} />);
    expect(screen.getByText("Moved to Applied")).toBeTruthy();
    const messages = screen.getByRole("button", { name: "Messages" });
    fireEvent.click(messages);
    expect(messages.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Old note")).toBeNull();
    expect(screen.queryByText("Moved to Applied")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("Old note")).toBeTruthy();
  });

  it("groups the timeline by day and folds edits in a row into one line", () => {
    const at = "2026-10-20T10:00:00.000Z";
    render(
      <Harness
        start={entry({
          changes: [
            { at, text: "CV set to v2" },
            { at, text: "Follow-up moved to Oct 28" },
          ],
        })}
      />,
    );
    const history = screen.getByRole("list", { name: "History" });
    expect(within(history).getByText("Today")).toBeTruthy();
    expect(within(history).getByText("2 edits: Follow-up moved to Oct 28, CV set to v2")).toBeTruthy();
  });

  it("pins an overdue follow-up with Log follow-up, which fills the composer, and Snooze", () => {
    const onPatch = vi.fn();
    render(<Harness start={entry({ followUp: "2026-10-18", contacts: [priya] })} onPatch={onPatch} />);
    const step = screen.getByRole("region", { name: "Next step" });
    expect(within(step).getByText(/Overdue since/)).toBeTruthy();
    fireEvent.click(within(step).getByRole("button", { name: "Log follow-up" }));
    expect((screen.getByLabelText("What was said") as HTMLTextAreaElement).value).toMatch(/^Hi, I applied for the Product manager role/);
    fireEvent.click(within(step).getByRole("button", { name: "Snooze" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));
    expect(onPatch).toHaveBeenLastCalledWith({ followUp: "2026-10-21" });
  });

  it("shows people as cards with only the links their details allow", () => {
    render(<Harness start={entry({ contacts: [priya, { id: "p2", name: "Omar", phone: "050 123 4567", whatsapp: true }] })} />);
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).getByRole("link", { name: "Email" }).getAttribute("href")).toBe("mailto:priya@acme.test");
    expect(within(first!).getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe("https://wa.me/971501234567");
    expect(within(first!).getByRole("link", { name: "LinkedIn" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(second!).queryByRole("link", { name: "WhatsApp" })).toBeNull();
    expect(within(second!).getByRole("link", { name: "Call" })).toBeTruthy();
    expect(within(second!).getByText("Add the country code to use WhatsApp.")).toBeTruthy();
  });

  it("adds a person from the empty state, filling fields from a paste", () => {
    const onPatch = vi.fn();
    render(<Harness start={entry()} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Priya" } });
    fireEvent.paste(name, { clipboardData: { getData: () => "priya@acme.test" } });
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("priya@acme.test");
    expect((name as HTMLInputElement).value).toBe("Priya");
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    expect(onPatch.mock.calls.at(-1)![0].contacts).toEqual([expect.objectContaining({ name: "Priya", email: "priya@acme.test" })]);
    expect(screen.getByRole("tab", { name: /People/ }).textContent).toContain("1");
  });

  it("edits a person on every job through updateContact, and adds someone you already know with the same id", () => {
    const updateContact = vi.fn();
    const onPatch = vi.fn();
    const state: UserState = { job1: entry({ contacts: [priya] }), job2: entry({ contacts: [{ id: "p2", name: "Omar" }] }) };
    render(
      <PeopleProvider value={{ state, updateContact }}>
        <Harness start={state.job1!} onPatch={onPatch} />
      </PeopleProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Priya Shah" }));
    fireEvent.change(screen.getByLabelText("Company or agency"), { target: { value: "Hays" } });
    fireEvent.click(screen.getByRole("button", { name: "Save person" }));
    expect(updateContact).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", company: "Hays" }));
    fireEvent.change(screen.getByLabelText("Add someone you already know"), { target: { value: "p2" } });
    expect(onPatch.mock.calls.at(-1)![0].contacts.map((c: { id: string }) => c.id)).toEqual(["p1", "p2"]);
  });

  it("adds an interview with its time and person", () => {
    const onPatch = vi.fn();
    render(<Harness start={entry({ contacts: [priya] })} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("tab", { name: "Interviews" }));
    fireEvent.click(screen.getByRole("button", { name: "Add interview" }));
    const form = within(screen.getByRole("form", { name: "Add an interview" }));
    fireEvent.click(form.getByRole("button", { name: "Technical" }));
    // Saving without a day asks for one.
    fireEvent.click(form.getByRole("button", { name: "Save interview" }));
    expect(form.getByText("Pick the day of the interview.")).toBeTruthy();
    fireEvent.click(form.getByLabelText("Date"));
    const day = new Date("2026-10-23T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Interview date" })).getByRole("button", { name: day }));
    const time = form.getByLabelText("Time");
    fireEvent.change(time, { target: { value: "2:30 pm" } });
    fireEvent.blur(time);
    fireEvent.change(form.getByLabelText("With"), { target: { value: "p1" } });
    fireEvent.click(form.getByRole("button", { name: "Save interview" }));
    expect(onPatch.mock.calls.at(-1)![0]).toEqual({ interviews: [{ on: "2026-10-23", what: "Technical", time: "14:30", contactId: "p1" }] });
    expect(screen.getByText(/with Priya Shah/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Add an interview" })).toBeNull();
  });
});

describe("TrackedJobDialog", () => {
  it("shows a hand-added job's own fields in Details, which rename it through the snapshot", () => {
    const onUpdate = vi.fn();
    const { unmount } = render(<TrackedJobDialog id="manual:abc" entry={entry({ cv: "PM v3" })} onClose={() => {}} onUpdate={onUpdate} />);
    // A side panel on wide screens, a Details tab on narrow ones.
    const details = screen.queryByRole("tab", { name: "Details" });
    if (details) fireEvent.click(details);
    const title = screen.getByLabelText("Job title");
    fireEvent.change(title, { target: { value: "Senior product manager" } });
    fireEvent.blur(title);
    expect(onUpdate).toHaveBeenCalledWith({}, { title: "Senior product manager", company: "Acme", url: "https://acme.test/1" });
    expect((screen.getByLabelText("CV used") as HTMLInputElement).value).toBe("PM v3");
    unmount();
    render(<TrackedJobDialog id="greenhouse:acme:1" entry={entry()} onClose={() => {}} onUpdate={onUpdate} />);
    expect(screen.queryByLabelText("Job title")).toBeNull();
    expect(screen.getByRole("list", { name: "History" })).toBeTruthy();
  });
});

describe("review fixes", () => {
  it("leaves a Saved job's Apply by date alone when a touch is logged, and hides Next follow-up", () => {
    const saved = entry({ status: "saved", followUp: "2026-10-25", history: [{ status: "saved", at: "2026-10-12T09:00:00.000Z" }] });
    const sent = { id: "x", at: now.toISOString(), channel: "email" as const, dir: "sent" as const };
    expect(addActivity(saved, sent, { followUpDays: 7 }, now)).not.toHaveProperty("followUp");
    expect(addActivity(saved, { ...sent, dir: "received" }, {}, now)).not.toHaveProperty("followUp");
    render(<Harness start={saved} />);
    expect(screen.queryByText("Next follow-up in")).toBeNull();
  });

  it("keeps updatedAt when a hand-added job is only renamed", () => {
    const prev = entry({ history: undefined });
    const next = applyPatch(prev, { id: "manual:a", ...snapshot, title: "Lead" }, {}, now.toISOString())!;
    expect(next.updatedAt).toBe(prev.updatedAt);
    expect(next.snapshot.title).toBe("Lead");
  });

  it("saves a picked snooze date only from tomorrow on", () => {
    const onPatch = vi.fn();
    render(<Harness start={entry({ followUp: "2026-10-18" })} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pick a date" }));
    const cal = within(screen.getByRole("dialog", { name: "Follow up on" }));
    const name = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    fireEvent.click(cal.getByRole("button", { name: name("2026-10-19") }));
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.click(cal.getByRole("button", { name: name("2026-10-28") }));
    expect(onPatch).toHaveBeenCalledWith({ followUp: "2026-10-28" });
  });

  it("keeps a half-written touch when Add a person switches tabs and back", () => {
    render(<Harness start={entry()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log a message, call or note…" }));
    fireEvent.change(screen.getByLabelText("What was said"), { target: { value: "Draft" } });
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "__add" } });
    expect(screen.getByRole("tab", { name: /People/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect((screen.getByLabelText("What was said") as HTMLTextAreaElement).value).toBe("Draft");
  });

  it("offers Undo after removing a person", () => {
    const onPatch = vi.fn();
    render(<Harness start={entry({ contacts: [priya] })} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Priya Shah from this job" }));
    expect(onPatch).toHaveBeenLastCalledWith({ contacts: [] });
    const t = vi.mocked(toast).mock.calls.at(-1)![0];
    expect(t.actionLabel).toBe("Undo");
    t.onAction?.();
    expect(onPatch).toHaveBeenLastCalledWith({ contacts: [priya] });
  });

  it("keeps an older non-LinkedIn link on edit, and flags a new one instead of dropping it", () => {
    const updateContact = vi.fn();
    const omar = { id: "p2", name: "Omar", link: "https://omar.example/portfolio" };
    const state: UserState = { job1: entry({ contacts: [omar] }) };
    render(
      <PeopleProvider value={{ state, updateContact }}>
        <Harness start={state.job1!} />
      </PeopleProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Omar" }));
    fireEvent.change(screen.getByLabelText("Company or agency"), { target: { value: "Hays" } });
    fireEvent.click(screen.getByRole("button", { name: "Save person" }));
    expect(updateContact).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p2", company: "Hays", link: "https://omar.example/portfolio" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Omar" }));
    fireEvent.change(screen.getByLabelText("LinkedIn"), { target: { value: "https://twitter.com/omar" } });
    fireEvent.click(screen.getByRole("button", { name: "Save person" }));
    expect(updateContact).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Use a LinkedIn profile link/)).toBeTruthy();
  });

  it("edits and deletes the older note in place", () => {
    const onPatch = vi.fn();
    render(<Harness start={entry({ note: "Old note" })} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onPatch).toHaveBeenLastCalledWith({ note: "New note" });
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    expect(onPatch).toHaveBeenLastCalledWith({ note: undefined });
  });
});
