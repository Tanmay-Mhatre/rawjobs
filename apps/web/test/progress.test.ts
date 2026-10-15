import { describe, expect, it } from "vitest";
import { applyPatch, dayAfter, type Entry, followUpDue, statusLabel } from "../src/lib/userState";

const job = { id: "greenhouse:acme:1", title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };

describe("progress tracking", () => {
  it("dates every status change, oldest first", () => {
    const saved = applyPatch(undefined, job, { status: "saved" }, "2026-10-15T09:00:00Z")!;
    const applied = applyPatch(saved, job, { status: "applied" }, "2026-10-16T09:00:00Z")!;
    expect(applied.history).toEqual([
      { status: "saved", at: "2026-10-15T09:00:00Z" },
      { status: "applied", at: "2026-10-16T09:00:00Z" },
    ]);
    // A note alone isn't a step.
    expect(applyPatch(applied, job, { note: "Ask Sam" }, "2026-10-17T09:00:00Z")!.history).toHaveLength(2);
  });

  it("starts the history from a job tracked before it existed", () => {
    const old: Entry = { status: "saved", updatedAt: "2026-10-01T09:00:00Z", snapshot: { ...job } };
    expect(applyPatch(old, job, { status: "applied" }, "2026-10-16T09:00:00Z")!.history?.[0]).toEqual({ status: "saved", at: "2026-10-01T09:00:00Z" });
  });

  it("sets a follow-up a week after you apply, keeps your own date, and drops it when you move on", () => {
    const applied = applyPatch(undefined, job, { status: "applied" }, "2026-10-16T09:00:00Z")!;
    expect(applied.followUp).toBe(dayAfter("2026-10-16T09:00:00Z", 7));
    const moved = applyPatch(applied, job, { followUp: "2026-10-30" }, "2026-10-17T09:00:00Z")!;
    expect(moved.followUp).toBe("2026-10-30");
    expect(applyPatch(moved, job, { status: "interviewing" }, "2026-10-20T09:00:00Z")!.followUp).toBeUndefined();
  });

  it("is due on its date, only while applied", () => {
    const e: Entry = { status: "applied", followUp: "2026-10-23", updatedAt: "", snapshot: { ...job } };
    expect(followUpDue(e, new Date("2026-10-22T12:00:00"))).toBe(false);
    expect(followUpDue(e, new Date("2026-10-23T12:00:00"))).toBe(true);
    expect(followUpDue({ ...e, status: "interviewing" }, new Date("2026-10-30T12:00:00"))).toBe(false);
  });

  it("keeps how a closed job ended, only while it's closed", () => {
    const closed = applyPatch(undefined, job, { status: "rejected", closedAs: "withdrew" })!;
    expect(statusLabel(closed)).toBe("I withdrew");
    expect(applyPatch(closed, job, { status: "applied" })!.closedAs).toBeUndefined();
  });

  it("keeps a job with only a CV noted", () => {
    expect(applyPatch(undefined, job, { cv: "Fintech PM v3" })?.cv).toBe("Fintech PM v3");
    expect(applyPatch(undefined, job, { cv: "" })).toBeNull();
  });
});
