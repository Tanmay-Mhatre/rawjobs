// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
