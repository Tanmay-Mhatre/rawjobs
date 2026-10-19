import { describe, expect, it } from "vitest";
import { applyPatch, dayAfter, type Entry, goneQuiet, mergeStates, quickStatus, stageSince } from "../src/lib/userState";

const job = { id: "greenhouse:acme:1", title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };
const entry = (status: Entry["status"], updatedAt: string): Entry => ({ status, updatedAt, snapshot: { ...job } });

describe("one-tap statuses", () => {
  it("sets a status on an untracked job", () => {
    expect(quickStatus(undefined, "saved")).toBe("saved");
    expect(quickStatus(undefined, "applied")).toBe("applied");
  });

  it("clears Saved and Not interested when tapped again, but never Applied or later", () => {
    expect(quickStatus("saved", "saved")).toBeUndefined();
    expect(quickStatus("dismissed", "dismissed")).toBeUndefined();
    expect(quickStatus("applied", "applied")).toBeNull();
    expect(quickStatus("interviewing", "interviewing")).toBeNull();
  });

  it("never moves a job back", () => {
    expect(quickStatus("applied", "saved")).toBeNull();
    expect(quickStatus("interviewing", "applied")).toBeNull();
    expect(quickStatus("offer", "saved")).toBeNull();
    expect(quickStatus("rejected", "saved")).toBeNull();
    expect(quickStatus("saved", "applied")).toBe("applied");
    expect(quickStatus("rejected", "applied")).toBe("applied");
  });

  it("lets Not interested replace anything", () => {
    expect(quickStatus("applied", "dismissed")).toBe("dismissed");
    expect(quickStatus("dismissed", "saved")).toBe("saved");
  });
});

describe("time in stage", () => {
  it("counts from the step into the current status, not a later note edit", () => {
    const applied = applyPatch(undefined, job, { status: "applied" }, "2026-10-10T09:00:00Z")!;
    const noted = applyPatch(applied, job, { note: "Pinged Sam" }, "2026-10-15T09:00:00Z")!;
    expect(stageSince(noted)).toBe("2026-10-10T09:00:00Z");
  });

  it("falls back to the last change for jobs tracked before history", () => {
    expect(stageSince(entry("saved", "2026-10-01T09:00:00Z"))).toBe("2026-10-01T09:00:00Z");
  });
});

describe("import merge", () => {
  it("keeps both sides and takes the newer change for a job in both", () => {
    const mine = { a: entry("saved", "2026-10-01T00:00:00Z"), b: entry("applied", "2026-10-09T00:00:00Z") };
    const theirs = { b: entry("interviewing", "2026-10-05T00:00:00Z"), c: entry("offer", "2026-10-02T00:00:00Z") };
    const merged = mergeStates(mine, { ...theirs, a: entry("applied", "2026-10-03T00:00:00Z") });
    expect(merged.a.status).toBe("applied");
    expect(merged.b.status).toBe("applied");
    expect(merged.c.status).toBe("offer");
  });
});

describe("follow-ups", () => {
  it("suggests closing an application with no reply for three weeks", () => {
    const applied = applyPatch(undefined, job, { status: "applied" }, "2026-10-01T09:00:00Z")!;
    expect(goneQuiet(applied, new Date("2026-10-15T09:00:00Z"))).toBe(false);
    expect(goneQuiet(applied, new Date("2026-10-23T09:00:00Z"))).toBe(true);
    const interviewing = applyPatch(applied, job, { status: "interviewing" }, "2026-10-10T09:00:00Z")!;
    expect(goneQuiet(interviewing, new Date("2026-11-30T09:00:00Z"))).toBe(false);
  });

  it("backdates when you reached the current status", () => {
    const applied = applyPatch(undefined, job, { status: "applied" }, "2026-10-16T09:00:00Z")!;
    const moved = applyPatch(applied, job, { since: "2026-10-05" }, "2026-10-16T10:00:00Z")!;
    expect(moved.history).toHaveLength(1);
    expect(dayAfter(stageSince(moved), 0)).toBe("2026-10-05");
  });
});

describe("chasing a quiet application", () => {
  it("waits for the new follow-up date before nudging again", () => {
    const applied = applyPatch(undefined, job, { status: "applied" }, "2026-10-01T09:00:00Z")!;
    const chased = applyPatch(applied, job, { followUp: "2026-10-30" }, "2026-10-23T09:00:00Z")!;
    expect(goneQuiet(chased, new Date("2026-10-24T09:00:00Z"))).toBe(false);
    expect(goneQuiet(chased, new Date("2026-10-30T09:00:00Z"))).toBe(true);
  });
});

describe("interviews and people", () => {
  it("keeps them on the entry and drops empty lists", () => {
    const e = applyPatch(undefined, job, { status: "interviewing", interviews: [{ on: "2026-10-24", what: "Technical" }], contacts: [] }, "2026-10-19T09:00:00Z")!;
    expect(e.interviews).toEqual([{ on: "2026-10-24", what: "Technical" }]);
    expect(e).not.toHaveProperty("contacts");
  });
});

describe("offers", () => {
  it("keeps the terms you wrote and drops an empty offer", () => {
    const e = applyPatch(undefined, job, { status: "offer", offer: { pay: "AED 45k a month", deadline: "2026-10-25" } }, "2026-10-19T09:00:00Z")!;
    expect(e.offer).toEqual({ pay: "AED 45k a month", deadline: "2026-10-25" });
    expect(applyPatch(e, job, { offer: { pay: undefined } }, "2026-10-19T10:00:00Z")).not.toHaveProperty("offer");
  });
});
