import { describe, expect, it } from "vitest";
import { filterTimeline, timeline } from "../src/components/pipeline/detail";
import { type Activity, addActivity, applyPatch, CAPS, type Entry } from "../src/lib/userState";

const job = { id: "greenhouse:acme:1", title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };
const snapshot = { title: job.title, company: job.company, url: job.url, location: job.location, score: job.score };
const entry = (o: Partial<Entry> = {}): Entry => ({ status: "applied", updatedAt: "2026-10-10T09:00:00.000Z", snapshot, ...o });
const touch = (o: Partial<Activity> = {}): Activity => ({ id: "a1", at: "2026-10-12T09:00:00.000Z", channel: "email", dir: "sent", text: "Hi", ...o });
/** A day as the app writes it, in this machine's locale. */
const d = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const at = "2026-10-21T10:00:00.000Z";
const texts = (prev: Entry, patch: Parameters<typeof applyPatch>[2]) => (applyPatch(prev, job, patch, at)?.changes ?? []).map((c) => c.text);

describe("change log", () => {
  it("logs a follow-up date you set, move or clear", () => {
    expect(texts(entry(), { followUp: "2026-10-28" })).toEqual([`Follow-up set for ${d("2026-10-28")}`]);
    expect(texts(entry({ followUp: "2026-10-25" }), { followUp: "2026-10-28" })).toEqual([`Follow-up moved to ${d("2026-10-28")}`]);
    expect(texts(entry({ followUp: "2026-10-25" }), { followUp: undefined })).toEqual(["Follow-up date cleared"]);
    expect(texts(entry({ status: "saved" }), { followUp: "2026-10-28" })).toEqual([`Apply by set for ${d("2026-10-28")}`]);
  });

  it("leaves out the dates a move or a logged touch set by themselves", () => {
    expect(texts(entry({ status: "saved" }), { status: "applied" })).toEqual([]);
    expect(texts(entry(), addActivity(entry(), touch(), { followUpDays: 7 }))).toEqual([]);
  });

  it("logs people, interviews, CV, offer, referral asks and done steps", () => {
    const priya = { id: "p", name: "Priya", role: "recruiter" as const };
    expect(texts(entry(), { contacts: [priya] })).toEqual(["Added Priya (Recruiter)"]);
    expect(texts(entry({ contacts: [priya] }), { contacts: [{ ...priya, email: "p@acme.example" }] })).toEqual(["Updated Priya's details"]);
    expect(texts(entry({ contacts: [priya] }), { contacts: [] })).toEqual(["Removed Priya"]);
    expect(texts(entry({ contacts: [priya], outreach: { p: { stage: "to-contact", at } } }), { outreach: { p: { stage: "messaged", at } } })).toEqual(["Referral ask with Priya: Messaged"]);

    const round = { on: "2026-10-30", what: "Technical" };
    expect(texts(entry(), { interviews: [round] })).toEqual([`Interview added: Technical, ${d("2026-10-30")}`]);
    expect(texts(entry({ interviews: [round] }), { interviews: [{ ...round, time: "14:00" }] })).toEqual([
      `Interview changed: Technical, ${d("2026-10-30")}, ${new Date("2000-01-01T14:00:00").toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
    ]);
    expect(texts(entry({ interviews: [round] }), { interviews: [] })).toEqual([`Interview removed: Technical, ${d("2026-10-30")}`]);

    expect(texts(entry(), { cv: "Fintech PM v3" })).toEqual(["CV set to Fintech PM v3"]);
    expect(texts(entry(), { offer: { pay: "AED 45k" } })).toEqual(["Offer details added"]);
    expect(texts(entry({ offer: { pay: "AED 45k" } }), { offer: { pay: "AED 50k", bonus: "15%" } })).toEqual(["Offer updated: pay, bonus"]);
    expect(texts(entry(), { skipped: ["follow-up:2026-10-22"] })).toEqual(["Follow-up marked done"]);
  });

  it("logs edited and deleted touches, but not new ones", () => {
    const e = entry({ activities: [touch(), touch({ id: "n1", channel: "note", dir: undefined })] });
    expect(texts(e, { activities: [touch({ text: "Hello" }), touch({ id: "n1", channel: "note", dir: undefined })] })).toEqual(["Edited a message"]);
    expect(texts(e, { activities: [touch()] })).toEqual(["Deleted a note"]);
    expect(texts(e, { activities: [...e.activities!, touch({ id: "a2" })] })).toEqual([]);
  });

  it("logs the date you moved a stage to", () => {
    expect(texts(entry(), { since: "2026-10-12" })).toEqual([`Applied date set to ${d("2026-10-12")}`]);
  });

  it("keeps the newest changes within the cap", () => {
    const many = Array.from({ length: CAPS.changes }, (_, i) => ({ at, text: `Change ${i}` }));
    const changes = applyPatch(entry({ changes: many }), job, { cv: "v2" }, at)?.changes ?? [];
    expect(changes).toHaveLength(CAPS.changes);
    expect(changes.at(-1)?.text).toBe("CV set to v2");
  });

  it("shows changes in the timeline and under Changes", () => {
    const e = applyPatch(entry({ history: [{ status: "applied", at: "2026-10-12T09:00:00.000Z" }] }), job, { cv: "v2" }, at)!;
    const items = timeline(e);
    expect(items[0]).toMatchObject({ kind: "change", text: "CV set to v2" });
    expect(filterTimeline(items, "changes").map((i) => i.kind)).toEqual(["change"]);
    expect(filterTimeline(items, "messages").some((i) => i.kind === "change")).toBe(false);
  });
});
