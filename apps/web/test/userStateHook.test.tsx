// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSaveFailed, save, saveFailed } from "../src/lib/storage";
import { __resetHealthForTests } from "../src/lib/health";
import { resetTrackingSync } from "../src/lib/tracking";
import { type Entry, useUserState } from "../src/lib/userState";
import { trackingServer } from "./trackingServer";

const snapshot = { title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };
const entry = (o: Partial<Entry>): Entry => ({ status: "applied", updatedAt: "2026-10-10T09:00:00.000Z", snapshot, ...o });

beforeEach(() => {
  resetTrackingSync();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ tracking: null }))),
  );
});
afterEach(() => {
  cleanup();
  __resetHealthForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  onSaveFailed(undefined);
});

describe("useUserState", () => {
  it("reads v1 people as v2 and edits a person on every job without moving updatedAt", () => {
    localStorage.setItem(
      "rawjobs.state.v1",
      JSON.stringify({
        a: entry({ contacts: [{ id: "p", name: "Priya", role: "recruiter" }] }),
        b: entry({ contacts: [{ id: "p", name: "Priya", role: "recruiter" }, { name: "Sam", role: "Hiring manager" } as never] }),
        c: entry({}),
      }),
    );
    const { result } = renderHook(() => useUserState());
    expect(result.current.state.b!.contacts![1]).toEqual({ id: "v1:b:1", name: "Sam", role: "hiring-manager" });
    const c = result.current.state.c;
    act(() => result.current.updateContact({ id: "p", name: "Priya Raman", role: "agency", email: "priya@agency.example" }));
    expect(result.current.state.a!.contacts![0]).toEqual({ id: "p", name: "Priya Raman", role: "agency", email: "priya@agency.example" });
    expect(result.current.state.b!.contacts![0]!.name).toBe("Priya Raman");
    expect(result.current.state.a!.updatedAt).toBe("2026-10-10T09:00:00.000Z");
    // Jobs without that person are left as they were.
    expect(result.current.state.c).toBe(c);
  });
});

describe("save failures", () => {
  it("says when the browser refuses a save, at most once a minute", () => {
    const failed = vi.fn();
    onSaveFailed(failed);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(save("rawjobs.state.v1", {})).toBe(false);
    saveFailed();
    saveFailed();
    expect(failed).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    expect(save("rawjobs.state.v1", {})).toBe(true);
  });

  it("says when the local API refuses the save", async () => {
    const failed = vi.fn();
    onSaveFailed(failed);
    localStorage.setItem("rawjobs.state.v1", JSON.stringify({ a: entry({}) }));
    trackingServer(null, { status: (m) => (m === "PATCH" ? 400 : undefined) });
    renderHook(() => useUserState());
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  });
});

describe("saving to your RawJobs folder", () => {
  const job = { id: "a", ...snapshot };
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("one status change stringifies the state once", async () => {
    trackingServer({ state: { a: entry({}), b: entry({ status: "saved" }) } });
    const { result } = renderHook(() => useUserState());
    await waitFor(() => expect(result.current.state).toHaveProperty("b"));
    await settle();
    const stringify = vi.spyOn(JSON, "stringify");
    act(() => result.current.update(job, { status: "interviewing" }));
    await settle();
    const whole = stringify.mock.calls.filter(([v]) => v && typeof v === "object" && "a" in v && "b" in v);
    stringify.mockRestore();
    // The browser copy, once; the save to the file sends only the changed job.
    expect(whole).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("rawjobs.state.v1")!).a.status).toBe("interviewing");
  });

  it("same-job conflict merges activities via mergeStates", async () => {
    const touch = (id: string, at: string) => ({ id, at, channel: "email" as const, dir: "sent" as const });
    const api = trackingServer({ state: { a: entry({ activities: [touch("t1", "2026-10-10T09:00:00.000Z")] }) } });
    const { result } = renderHook(() => useUserState());
    await waitFor(() => expect(result.current.state.a?.activities).toHaveLength(1));
    // Another window logs a touch on the same job...
    api.edit("state", "a", entry({ updatedAt: "2026-10-11T09:00:00.000Z", activities: [touch("t1", "2026-10-10T09:00:00.000Z"), touch("t2", "2026-10-11T09:00:00.000Z")] }));
    // ...while this one logs another.
    act(() => result.current.update(job, { activities: [...result.current.state.a!.activities!, touch("t3", "2026-10-12T09:00:00.000Z")] }));
    await settle();
    const saved = (api.file() as { state: Record<string, Entry> }).state.a!;
    expect(saved.activities!.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(api.saves().map((c) => c.method)).toEqual(["PATCH", "PATCH"]);
    await waitFor(() => expect(result.current.state.a!.activities!.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]));
  });
});

describe("restore", () => {
  it("restore writes the entry back byte-identical", () => {
    const before = entry({ history: [{ status: "applied", at: "2026-10-10T09:00:00.000Z" }], followUp: "2026-10-30", followUpPicked: true });
    localStorage.setItem("rawjobs.state.v1", JSON.stringify({ a: before }));
    const { result } = renderHook(() => useUserState());
    const job = { id: "a", ...snapshot };
    act(() => result.current.update(job, { status: undefined }));
    expect(result.current.state.a!.status).toBeUndefined();
    act(() => result.current.restore("a", before));
    expect(JSON.stringify(result.current.state.a)).toBe(JSON.stringify(before));
    act(() => result.current.restore("a", null));
    expect(result.current.state).not.toHaveProperty("a");
  });
});
