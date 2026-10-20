import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newCtx } from "../src/lib/newSince";
import { REVIEW_MAX, toReview } from "../src/lib/toReview";
import type { Entry } from "../src/lib/userState";
import { makeJob } from "./helpers";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 864e5).toISOString();
const ctx = { user: {}, min: 70, hiddenCompanies: new Set<string>(), now: NOW };
const tracked = (status: Entry["status"]): Entry => ({ status, updatedAt: daysAgo(0), snapshot: { title: "", company: "", url: "", location: "", score: 0 } });

describe("toReview", () => {
  it("takes new strong matches you haven't tracked or hidden, newest first", () => {
    const fresh = makeJob({ company: "A", title: "Head of Product", firstSeen: daysAgo(1) });
    const newer = makeJob({ company: "B", title: "Head of Product", firstSeen: daysAgo(0.5) });
    const weak = makeJob({ company: "C", score: 50, firstSeen: daysAgo(1) });
    const old = makeJob({ company: "D", firstSeen: daysAgo(9) });
    const saved = makeJob({ company: "E", firstSeen: daysAgo(1) });
    const dismissed = makeJob({ company: "F", firstSeen: daysAgo(1) });
    const hidden = makeJob({ company: "G", firstSeen: daysAgo(1) });
    const gated = makeJob({ company: "H", firstSeen: daysAgo(1), why: { ...fresh.why, gate: "Needs Arabic" } as never });
    const closed = makeJob({ company: "I", firstSeen: daysAgo(1), status: "closed" });
    const r = toReview([fresh, newer, weak, old, saved, dismissed, hidden, gated, closed], {
      ...ctx,
      user: { [saved.id]: tracked("saved"), [dismissed.id]: tracked("dismissed") },
      hiddenCompanies: new Set(["G"]),
    });
    expect(r.jobs.map((j) => j.company)).toEqual(["B", "A"]);
    expect(r.total).toBe(2);
  });

  it("keeps one posting per role, and none for a role you track", () => {
    const a = makeJob({ company: "Acme", title: "Head of Product", location: "Dubai", firstSeen: daysAgo(2) });
    const b = makeJob({ company: "Acme", title: "Head of Product", location: "Abu Dhabi", firstSeen: daysAgo(1) });
    expect(toReview([a, b], ctx).jobs).toEqual([b]);
    expect(toReview([a, b], { ...ctx, user: { [a.id]: tracked("applied") } }).jobs).toEqual([]);
  });

  it("shows at most 12 and counts the rest", () => {
    const jobs = Array.from({ length: 15 }, (_, i) => makeJob({ company: `Co ${i}`, firstSeen: daysAgo(i / 10) }));
    const r = toReview(jobs, ctx);
    expect(r.jobs).toHaveLength(REVIEW_MAX);
    expect(r.total).toBe(15);
    expect(r.jobs[0]!.company).toBe("Co 0");
  });
});

describe("newCtx", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("skips partial scans and says when the first scan is the only one", () => {
    const S1 = "2026-10-10T09:00:00.000Z";
    const S2 = "2026-10-10T12:00:00.000Z";
    expect(newCtx([{ finishedAt: S1, partial: false }])).toEqual({ firstScan: true, newSince: undefined });
    store.clear();
    expect(newCtx([{ finishedAt: "2026-10-10T13:00:00.000Z", partial: true }, { finishedAt: S2 }, { finishedAt: S1 }])).toEqual({ firstScan: false, newSince: Date.parse(S1) });
  });
});
