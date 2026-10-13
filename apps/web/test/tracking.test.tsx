// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setThemeChoice, useSavedAppearance } from "../src/lib/theme";
import { resetTrackingSync, useSavedOnDisk } from "../src/lib/tracking";

type Call = { method: string; body?: unknown };

/** A stand-in for the local API's /api/tracking, holding what's "on disk". */
function fakeApi(onDisk: Record<string, unknown> | null) {
  const calls: Call[] = [];
  let file = onDisk;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
        calls.push({ method, body });
        file = { ...file, ...body };
        return new Response(JSON.stringify({ ok: true }));
      }
      calls.push({ method });
      return new Response(JSON.stringify({ tracking: file }));
    }),
  );
  return { calls, file: () => file };
}

function useTracked(initial: Record<string, string>) {
  const [value, setValue] = useState(initial);
  useSavedOnDisk("state", value, setValue);
  return { value, setValue };
}

beforeEach(() => {
  resetTrackingSync();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSavedOnDisk", () => {
  it("uploads this browser's copy when nothing is saved on disk yet", async () => {
    const api = fakeApi(null);
    renderHook(() => useTracked({ j1: "saved" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.file()).toEqual({ state: { j1: "saved" } });
  });

  it("shows what's on disk, without saving it straight back", async () => {
    const api = fakeApi({ state: { j2: "applied" } });
    const { result } = renderHook(() => useTracked({ j1: "saved" }));
    await waitFor(() => expect(result.current.value).toEqual({ j2: "applied" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("saves each change after a moment, together", async () => {
    const api = fakeApi({ state: {} });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(api.calls.length).toBe(1));
    act(() => result.current.setValue({ j1: "saved" }));
    act(() => result.current.setValue({ j1: "applied" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.calls.filter((c) => c.method === "PUT")).toEqual([{ method: "PUT", body: { state: { j1: "applied" } } }]);
  });

  it("saves nothing when the local API can't be reached, so an old copy never overwrites the file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const { result } = renderHook(() => useTracked({ j1: "saved" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => result.current.setValue({ j1: "applied" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toEqual([]);
  });
});

describe("useSavedAppearance", () => {
  const flushSaves = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

  it("brings back the theme saved in your RawJobs folder, at a new address with nothing in this browser", async () => {
    fakeApi({ appearance: { theme: "dark", density: "compact", maxAge: 180 } });
    renderHook(() => useSavedAppearance());
    await waitFor(() => expect(document.documentElement.dataset.theme).toMatch(/^dark/));
    expect(localStorage.getItem("rawjobs.theme")).toBe("dark");
    expect(localStorage.getItem("rawjobs.density")).toBe("compact");
    expect(localStorage.getItem("rawjobs.maxAge")).toBe("180");
  });

  it("uploads this browser's choices when the file has none yet", async () => {
    localStorage.setItem("rawjobs.theme", "light");
    const api = fakeApi({ state: {} });
    renderHook(() => useSavedAppearance());
    await flushSaves();
    expect(api.file()).toMatchObject({ appearance: { theme: "light" } });
  });

  it("saves a theme picked in Settings, and System as no choice", async () => {
    const api = fakeApi({ appearance: {} });
    renderHook(() => useSavedAppearance());
    await waitFor(() => expect(api.calls.length).toBe(1));
    act(() => setThemeChoice("dark"));
    await flushSaves();
    expect(api.file()).toMatchObject({ appearance: { theme: "dark" } });
    act(() => setThemeChoice("system"));
    await flushSaves();
    expect(api.file()).toMatchObject({ appearance: {} });
  });
});
