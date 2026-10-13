// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "../src/lib/storage";
import { resetTrackingSync, restoreFromDisk, useSavedOnDisk } from "../src/lib/tracking";

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

describe("restoreFromDisk", () => {
  const flushSaves = () => vi.advanceTimersByTimeAsync(500);
  const puts = (api: { calls: Call[] }) => api.calls.filter((c) => c.method === "PUT");

  it("puts what your RawJobs folder remembers in this browser, before the page draws", async () => {
    localStorage.setItem("rawjobs.checklist.dismissed", "true");
    localStorage.setItem("rawjobs.companiesTab", '"mine"');
    fakeApi({ browser: { "rawjobs.radar.seen": { latest: "2026-10-13T06:00:00Z" }, "rawjobs.scanScope": "all" } });
    await restoreFromDisk();
    expect(JSON.parse(localStorage.getItem("rawjobs.radar.seen")!)).toEqual({ latest: "2026-10-13T06:00:00Z" });
    expect(localStorage.getItem("rawjobs.scanScope")).toBe('"all"');
    // Kept keys the file doesn't have are cleared; keys that only live in the browser are left alone.
    expect(localStorage.getItem("rawjobs.checklist.dismissed")).toBeNull();
    expect(localStorage.getItem("rawjobs.companiesTab")).toBe('"mine"');
  });

  it("uploads this browser's copy when the file has none yet", async () => {
    localStorage.setItem("rawjobs.scanAsk", "false");
    localStorage.setItem("rawjobs.whyOpen", "true");
    const api = fakeApi({ state: {} });
    await restoreFromDisk();
    await flushSaves();
    expect(api.file()).toMatchObject({ browser: { "rawjobs.scanAsk": false } });
    expect((api.file() as { browser: object }).browser).not.toHaveProperty("rawjobs.whyOpen");
  });

  it("saves a change to a kept key, and nothing for the others", async () => {
    const api = fakeApi({ browser: {} });
    await restoreFromDisk();
    save("rawjobs.companiesTab", "mine");
    await flushSaves();
    expect(puts(api)).toEqual([]);
    save("rawjobs.notThisOne", ["acme"]);
    save("rawjobs.welcomeSeen", true);
    await flushSaves();
    expect(puts(api)).toEqual([{ method: "PUT", body: { browser: { "rawjobs.notThisOne": ["acme"], "rawjobs.welcomeSeen": true } } }]);
  });

  it("saves nothing while the local API can't be reached, so an old copy never overwrites the file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await restoreFromDisk();
    save("rawjobs.scanScope", "all");
    await flushSaves();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toEqual([]);
  });

  it("doesn't hold the page up for a slow server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    let done = false;
    void restoreFromDisk(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1100);
    expect(done).toBe(true);
  });
});
