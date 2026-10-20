// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSaveFailed, save, saveFailed } from "../src/lib/storage";
import { resetTrackingSync } from "../src/lib/tracking";
import { type Entry, useUserState } from "../src/lib/userState";

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "PUT" ? new Response(JSON.stringify({ ok: false }), { status: 400 }) : new Response(JSON.stringify({ tracking: null })))),
    );
    renderHook(() => useUserState());
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  });
});
