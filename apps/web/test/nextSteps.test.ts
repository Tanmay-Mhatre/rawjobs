import { afterEach, describe, expect, it } from "vitest";
import { cardState, closeSuggestion, groupTasks, lastActivity, nextSteps, tasksFor } from "../src/lib/nextSteps";
import type { Activity, Entry } from "../src/lib/userState";

const snapshot = { title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };
const entry = (o: Partial<Entry> = {}): Entry => ({ status: "applied", updatedAt: "2026-10-10T09:00:00.000Z", history: [{ status: "applied", at: "2026-10-10T09:00:00.000Z" }], snapshot, ...o });
const touch = (o: Partial<Activity> = {}): Activity => ({ id: Math.random().toString(36), at: "2026-10-12T09:00:00.000Z", channel: "email", dir: "sent", ...o });
/** Noon local on a day, so the date reads the same in any timezone. */
const noon = (day: string) => new Date(`${day}T12:00:00`);

const TZ = process.env.TZ;
afterEach(() => {
  // Assigning undefined would set the text "undefined" (read as UTC).
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

describe("tasks", () => {
  it("makes a follow-up task from the date, labelled Apply by on Saved", () => {
    const now = noon("2026-10-17");
    expect(tasksFor("a", entry({ followUp: "2026-10-17" }), now)).toMatchObject([{ key: "follow-up:2026-10-17", kind: "follow-up", due: "2026-10-17", label: "Follow up" }]);
    expect(tasksFor("a", entry({ status: "saved", followUp: "2026-10-20" }), now)[0]).toMatchObject({ label: "Apply by" });
    expect(tasksFor("a", entry({ status: "rejected", followUp: "2026-10-17" }), now)).toEqual([]);
  });

  it("takes the follow-up's person from the last sent touch", () => {
    const e = entry({ followUp: "2026-10-17", activities: [touch({ contactId: "p1" }), touch({ dir: "received", contactId: "p2", at: "2026-10-13T09:00:00.000Z" })] });
    const tasks = tasksFor("a", e, noon("2026-10-17"));
    expect(tasks.find((t) => t.kind === "follow-up")!.contactId).toBe("p1");
    // They wrote last: a Reply to them comes first.
    expect(tasks[0]).toMatchObject({ kind: "reply", key: "reply:2026-10-13", due: "2026-10-13", contactId: "p2" });
  });

  it("gives every active job a follow-up a week after its last move, touch or interview", () => {
    const now = noon("2026-10-20");
    const follow = (e: Entry) => tasksFor("a", e, now).find((t) => t.kind === "follow-up");
    // Saved and Interviewing with no date: a week after the move.
    expect(follow(entry({ status: "saved", history: [{ status: "saved", at: noon("2026-10-10").toISOString() }] }))).toMatchObject({ due: "2026-10-17", label: "Apply by" });
    expect(follow(entry({ status: "interviewing", history: [{ status: "interviewing", at: noon("2026-10-10").toISOString() }] }))).toMatchObject({ due: "2026-10-17", label: "Follow up" });
    // A later touch or an interview (even one still ahead) moves it on.
    expect(follow(entry({ status: "interviewing", activities: [touch({ at: noon("2026-10-15").toISOString() })] }))?.due).toBe("2026-10-22");
    expect(follow(entry({ status: "interviewing", interviews: [{ on: "2026-10-25", what: "Final" }] }))?.due).toBe("2026-11-01");
    // A date you set wins.
    expect(follow(entry({ status: "interviewing", followUp: "2026-10-19" }))?.due).toBe("2026-10-19");
    // Applied gets its date when you apply: none means the "No reply" flow, until they reply.
    expect(follow(entry())).toBeUndefined();
    expect(follow(entry({ activities: [touch({ dir: "received", at: noon("2026-10-14").toISOString() })] }))).toMatchObject({
      due: "2026-10-21",
      why: expect.stringMatching(/^They last wrote on (Oct 14|14 Oct)$/),
    });
  });

  it("asks for a reply when they wrote last, until you send something", () => {
    const now = noon("2026-10-20");
    const kinds = (e: Entry) => tasksFor("a", e, now).map((t) => t.kind);
    const wrote = touch({ dir: "received", channel: "whatsapp", at: noon("2026-10-14").toISOString() });
    expect(kinds(entry({ status: "interviewing", activities: [wrote] }))).toContain("reply");
    expect(kinds(entry({ status: "interviewing", activities: [wrote, touch({ at: noon("2026-10-15").toISOString() })] }))).not.toContain("reply");
    // A meeting or a referral asks for no answer, and done stays done.
    expect(kinds(entry({ status: "interviewing", activities: [{ ...wrote, channel: "meeting" }] }))).not.toContain("reply");
    expect(kinds(entry({ status: "interviewing", activities: [wrote], skipped: ["reply:2026-10-14"] }))).not.toContain("reply");
  });

  it("suggests a thank-you the day after an interview until you send a touch", () => {
    const e = entry({ status: "interviewing", interviews: [{ on: "2026-10-15", what: "Technical" }] });
    const thanks = (x: Entry, now: Date) => tasksFor("a", x, now).filter((t) => t.kind === "thank-you");
    expect(thanks(e, noon("2026-10-16"))).toMatchObject([{ key: "thank-you:2026-10-15", due: "2026-10-16", kind: "thank-you" }]);
    // Not on the day itself: it hasn't passed yet.
    expect(thanks(e, noon("2026-10-15"))).toEqual([]);
    // A touch the next day is the thank-you; one on the interview day (time unknown) may be from before it.
    expect(thanks({ ...e, activities: [touch({ at: noon("2026-10-16").toISOString() })] }, noon("2026-10-16"))).toEqual([]);
    expect(thanks({ ...e, activities: [touch({ at: noon("2026-10-15").toISOString() })] }, noon("2026-10-16"))).toHaveLength(1);
    // With the interview's time, a touch later that day counts and one before it doesn't.
    const timed = entry({ status: "interviewing", interviews: [{ on: "2026-10-15", what: "Technical", time: "10:00" }] });
    expect(thanks({ ...timed, activities: [touch({ at: noon("2026-10-15").toISOString() })] }, noon("2026-10-16"))).toEqual([]);
    expect(thanks({ ...timed, activities: [touch({ at: new Date("2026-10-15T09:00:00").toISOString() })] }, noon("2026-10-16"))).toHaveLength(1);
    // Long past and never sent: still there, overdue, until it's done.
    expect(thanks(e, noon("2026-11-15"))).toHaveLength(1);
    expect(thanks({ ...e, skipped: ["thank-you:2026-10-15"] }, noon("2026-11-15"))).toEqual([]);
  });

  it("lists interviews today to a week ahead, and offer deadlines up to a week ahead or past", () => {
    const e = entry({
      status: "offer",
      interviews: [
        { on: "2026-10-20", what: "Final", time: "14:00" },
        { on: "2026-10-30", what: "Later" },
      ],
      offer: { deadline: "2026-10-22" },
    });
    const tasks = tasksFor("a", e, noon("2026-10-20"));
    expect(tasks.map((t) => t.key)).toEqual(["interview:2026-10-20", "deadline:2026-10-22", "follow-up:2026-11-06"]);
    expect(tasks[0]).toMatchObject({ label: "Final interview", why: "At 14:00" });
    expect(tasksFor("a", entry({ status: "offer", offer: { deadline: "next friday" } }), noon("2026-10-20")).map((t) => t.kind)).toEqual(["follow-up"]);
    // A deadline that has passed stays, overdue, until you answer or mark it done.
    expect(tasksFor("a", entry({ status: "offer", offer: { deadline: "2026-10-18" } }), noon("2026-10-20")).map((t) => t.key)).toContain("deadline:2026-10-18");
  });

  it("hides a task marked done until its date changes", () => {
    const e = entry({ followUp: "2026-10-17", skipped: ["follow-up:2026-10-17"] });
    expect(tasksFor("a", e, noon("2026-10-17"))).toEqual([]);
    expect(tasksFor("a", { ...e, followUp: "2026-10-18" }, noon("2026-10-18"))).toHaveLength(1);
  });
});

describe("close suggestion", () => {
  it("comes after 21 days with no reply, or 2 follow-ups with none since", () => {
    expect(closeSuggestion(entry(), noon("2026-10-30"))).toBeUndefined();
    expect(closeSuggestion(entry(), noon("2026-11-01"))).toMatchObject({ followUps: 0 });
    const chased = entry({ activities: [touch({ followUp: true, at: "2026-10-14T09:00:00.000Z" }), touch({ followUp: true, at: "2026-10-18T09:00:00.000Z" })] });
    expect(closeSuggestion(chased, noon("2026-10-20"))).toMatchObject({ followUps: 2 });
    // A plain sent touch isn't a follow-up.
    expect(closeSuggestion(entry({ activities: [touch(), touch()] }), noon("2026-10-20"))).toBeUndefined();
  });

  it("starts over when they reply, and waits for a follow-up date ahead", () => {
    const replied = entry({ activities: [touch({ followUp: true }), touch({ followUp: true, at: "2026-10-13T09:00:00.000Z" }), touch({ dir: "received", at: "2026-10-14T09:00:00.000Z" })] });
    expect(closeSuggestion(replied, noon("2026-10-20"))).toBeUndefined();
    expect(closeSuggestion(entry({ followUp: "2026-11-05" }), noon("2026-11-01"))).toBeUndefined();
  });

  it("is a task keyed by the follow-up count, so Follow up once more can skip it", () => {
    const e = entry({ skipped: ["close:0"] });
    expect(tasksFor("a", e, noon("2026-11-01"))).toEqual([]);
    expect(tasksFor("a", entry(), noon("2026-11-01"))).toMatchObject([{ key: "close:0", due: "2026-11-01", kind: "close" }]);
  });
});

describe("nextSteps and groups", () => {
  it("maps job ids to their tasks and groups them by when they're due", () => {
    const now = noon("2026-10-20");
    const byJob = nextSteps(
      {
        late: entry({ followUp: "2026-10-18" }),
        due: entry({ followUp: "2026-10-20" }),
        soon: entry({ followUp: "2026-10-24" }),
        far: entry({ followUp: "2026-11-15" }),
        none: entry({ status: "rejected" }),
      },
      now,
    );
    expect([...byJob.keys()].sort()).toEqual(["due", "far", "late", "soon"]);
    const g = groupTasks(byJob, now);
    expect(g.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(g.today.map((t) => t.id)).toEqual(["due"]);
    expect(g.week.map((t) => t.id)).toEqual(["soon"]);
  });
});

describe("cardState", () => {
  const now = noon("2026-10-20");
  const state = (e: Entry) => cardState(e, tasksFor("a", e, now), now);
  it("says overdue (with days), today, later, none or closed", () => {
    expect(state(entry({ followUp: "2026-10-17" }))).toMatchObject({ tone: "overdue", days: 3 });
    expect(state(entry({ followUp: "2026-10-20" }))).toMatchObject({ tone: "today" });
    expect(state(entry({ status: "saved", followUp: "2026-10-25" }))).toMatchObject({ tone: "later" });
    // Saved with no date: Apply by a week after saving, so it never sits without a next step.
    expect(state(entry({ status: "saved" }))).toMatchObject({ tone: "overdue", days: 3 });
    expect(state(entry({ status: "saved", history: [{ status: "saved", at: noon("2026-10-18").toISOString() }] }))).toMatchObject({ tone: "later" });
    expect(state(entry({ status: "rejected" }))).toEqual({ tone: "closed" });
  });
  it("says quiet when applied with no reply for 21 days and no follow-up date ahead", () => {
    const e = entry({ skipped: ["close:0"], history: [{ status: "applied", at: noon("2026-09-28").toISOString() }] });
    expect(state(e)).toMatchObject({ tone: "quiet", days: 22 });
    // A follow-up date still ahead: you chased it, so it's waiting, not quiet.
    expect(state({ ...e, followUp: "2026-10-25" })).toMatchObject({ tone: "later" });
    // A week without a reply isn't quiet yet.
    expect(state(entry({ history: [{ status: "applied", at: noon("2026-10-10").toISOString() }] }))).toEqual({ tone: "none" });
    // They replied: not quiet, it's your turn.
    const replied = { ...e, activities: [touch({ dir: "received", at: "2026-10-18T09:00:00.000Z" })] };
    expect(state(replied)).toMatchObject({ tone: "overdue", days: 2, task: { kind: "reply" } });
  });
});

describe("lastActivity", () => {
  it("is the newest touch or stage change, in words", () => {
    const e = entry({ contacts: [{ id: "p", name: "Priya" }], activities: [touch({ channel: "linkedin", contactId: "p", at: "2026-10-12T09:00:00.000Z" })] });
    expect(lastActivity(e)).toEqual({ at: "2026-10-12T09:00:00.000Z", channel: "linkedin", text: "Messaged Priya on LinkedIn" });
    expect(lastActivity({ ...e, history: [...e.history!, { status: "interviewing", at: "2026-10-14T09:00:00.000Z" }] })).toEqual({ at: "2026-10-14T09:00:00.000Z", text: "Moved to Interviewing" });
    expect(lastActivity(entry({ activities: [touch({ dir: "received", contactId: "gone", at: "2026-10-12T09:00:00.000Z" })] }))!.text).toBe("Got an email");
  });
});

describe("timezones", () => {
  // 20:00 UTC on Oct 20 is Oct 21 morning in Auckland and Oct 20 afternoon in Los Angeles.
  const now = new Date("2026-10-20T20:00:00.000Z");

  it("works out today in local time", () => {
    const e = entry({ followUp: "2026-10-21", history: [{ status: "applied", at: "2026-10-18T09:00:00.000Z" }] });
    process.env.TZ = "Pacific/Auckland";
    expect(cardState(e, tasksFor("a", e, now), now).tone).toBe("today");
    process.env.TZ = "America/Los_Angeles";
    expect(cardState(e, tasksFor("a", e, now), now).tone).toBe("later");
  });

  it("compares a touch's local day with the interview day", () => {
    process.env.TZ = "America/Los_Angeles";
    const e = entry({ status: "interviewing", interviews: [{ on: "2026-10-20", what: "Final" }] });
    const later = new Date("2026-10-22T20:00:00.000Z");
    // Oct 21, 7pm in Los Angeles (Oct 22 in UTC): the next local day, so it counts.
    const kinds = (x: Entry) => tasksFor("a", x, later).map((t) => t.kind);
    expect(kinds({ ...e, activities: [touch({ at: "2026-10-22T02:00:00.000Z" })] })).not.toContain("thank-you");
    // Oct 20, 10pm in Los Angeles but Oct 21 in UTC: still the interview day locally, so it doesn't.
    expect(kinds({ ...e, activities: [touch({ at: "2026-10-21T05:00:00.000Z" })] })).toContain("thank-you");
  });

  it("puts the thank-you the next calendar day across a clock change", () => {
    process.env.TZ = "Europe/London";
    // Clocks go back on Oct 25, 2026 in London.
    const e = entry({ status: "interviewing", interviews: [{ on: "2026-10-24", what: "Final" }] });
    expect(tasksFor("a", e, new Date("2026-10-26T09:00:00.000Z")).find((t) => t.kind === "thank-you")!.due).toBe("2026-10-25");
  });
});
