import { describe, expect, it } from "vitest";
import { applyPatch, type Entry, mergeStates, quickStatus, stageSince } from "../src/lib/userState";

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
