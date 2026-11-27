// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetHealthForTests } from "../src/lib/health";
import { resetSaveProblem, useSaveFailedNotice } from "../src/app/saveFailedNotice";
import { usePrefs } from "../src/lib/prefs";
import { onSaveFailed, type SaveCause, save } from "../src/lib/storage";
import { setThemeChoice, useSavedAppearance } from "../src/lib/theme";
import { resetTrackingSync, restoreFromDisk, saveTrackingNow, useSavedOnDisk } from "../src/lib/tracking";
import { trackingServer } from "./trackingServer";

function useTracked(initial: Record<string, string>) {
  const [value, setValue] = useState(initial);
  useSavedOnDisk("state", value, setValue);
  return { value, setValue };
}

const flushSaves = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
const reads = (api: { calls: { method: string }[] }) => api.calls.filter((c) => c.method === "GET").length;
const stops: (() => void)[] = [];
/** Hear each cause a failed save gives. */
function failures() {
  const failed = vi.fn<(cause: SaveCause) => void>();
  stops.push(onSaveFailed(failed));
  return failed;
}

beforeEach(() => {
  resetTrackingSync();
  resetSaveProblem();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  __resetHealthForTests();
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSavedOnDisk", () => {
  it("uploads this browser's copy when nothing is saved on disk yet", async () => {
    const api = trackingServer(null);
    renderHook(() => useTracked({ j1: "saved" }));
    await waitFor(() => expect(reads(api)).toBe(1));
    await flushSaves();
    expect(api.file()).toEqual({ state: { j1: "saved" } });
  });

  it("shows what's on disk, without saving it straight back", async () => {
    const api = trackingServer({ state: { j2: "applied" } });
    const { result } = renderHook(() => useTracked({ j1: "saved" }));
    await waitFor(() => expect(result.current.value).toEqual({ j2: "applied" }));
    await flushSaves();
    expect(api.saves()).toEqual([]);
  });

  it("saves each change after a moment, together", async () => {
    const api = trackingServer({ state: {} });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(reads(api)).toBe(1));
    act(() => result.current.setValue({ j1: "saved" }));
    act(() => result.current.setValue({ j1: "applied" }));
    await flushSaves();
    expect(api.saves()).toEqual([{ method: "PATCH", ifMatch: '"e1:0"', body: { changes: { state: { set: { j1: "applied" }, del: [] } } } }]);
  });

  it("PATCH body holds only the changed entry", async () => {
    const api = trackingServer({ state: { j1: "saved", j2: "saved", j3: "applied" } });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toHaveProperty("j3"));
    act(() => result.current.setValue(({ j3: _, ...rest }) => ({ ...rest, j2: "interviewing" })));
    await flushSaves();
    expect(api.saves().map((c) => c.body)).toEqual([{ changes: { state: { set: { j2: "interviewing" }, del: ["j3"] } } }]);
  });

  it("two windows editing different jobs both survive", async () => {
    const api = trackingServer({ state: { a: "saved", b: "saved" } });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toEqual({ a: "saved", b: "saved" }));
    // The other window moves b; this one, which hasn't seen that yet, moves a.
    api.edit("state", "b", "interviewing");
    act(() => result.current.setValue((v) => ({ ...v, a: "applied" })));
    await flushSaves();
    expect(api.file()).toEqual({ state: { a: "applied", b: "interviewing" } });
    // ...and this window picks up the other's change.
    await waitFor(() => expect(result.current.value).toEqual({ a: "applied", b: "interviewing" }));
  });

  it("undo after a remote edit to another job is kept", async () => {
    const api = trackingServer({ state: { a: "saved" } });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toEqual({ a: "saved" }));
    act(() => result.current.setValue((v) => ({ ...v, b: "not-for-me" })));
    await flushSaves();
    api.edit("state", "c", "applied");
    // Undo: b goes away again.
    act(() => result.current.setValue(({ b: _, ...rest }) => rest));
    await flushSaves();
    expect(api.file()).toEqual({ state: { a: "saved", c: "applied" } });
    await waitFor(() => expect(result.current.value).toEqual({ a: "saved", c: "applied" }));
  });

  it("409 retries at most 3 times", async () => {
    const failed = failures();
    const patches = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/health") return new Response(JSON.stringify({ ok: true }));
        if (init?.method === "PATCH") {
          patches();
          // Another window keeps saving the same job first.
          const n = patches.mock.calls.length;
          return new Response(JSON.stringify({ ok: false, rev: n, epoch: "e1", tracking: { state: { j1: `theirs-${n}` } }, conflicts: [{ part: "state", key: "j1" }] }), { status: 409 });
        }
        return new Response(JSON.stringify({ tracking: { state: { j1: "saved" } }, rev: 0, epoch: "e1" }));
      }),
    );
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toEqual({ j1: "saved" }));
    act(() => result.current.setValue({ j1: "mine" }));
    await flushSaves();
    await flushSaves();
    expect(patches).toHaveBeenCalledTimes(4);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("conflict");
    // Without a merge for the part, this window's change is kept.
    expect(result.current.value).toEqual({ j1: "mine" });
  });

  it("fetch rejects → cause offline", async () => {
    const failed = failures();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/health") return new Response(JSON.stringify({ ok: true }));
        if (init?.method === "PATCH") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ tracking: { state: { j1: "saved" } }, rev: 0, epoch: "e1" }));
      }),
    );
    const { result } = renderHook(() => ({ tracked: useTracked({}), notice: useSaveFailedNotice(() => {}) }));
    await waitFor(() => expect(result.current.tracked.value).toEqual({ j1: "saved" }));
    act(() => result.current.tracked.setValue({ j1: "applied" }));
    await flushSaves();
    expect(failed.mock.calls).toEqual([["offline"]]);
    // The Reconnecting notice covers it: no save notice of its own.
    expect(result.current.notice).toBeNull();
  });

  it("400 → cause server", async () => {
    const failed = failures();
    trackingServer({ state: { j1: "saved" } }, { status: (m) => (m === "PATCH" ? 400 : undefined) });
    const { result } = renderHook(() => ({ tracked: useTracked({}), notice: useSaveFailedNotice(() => {}) }));
    await waitFor(() => expect(result.current.tracked.value).toEqual({ j1: "saved" }));
    act(() => result.current.tracked.setValue({ j1: "applied" }));
    await flushSaves();
    expect(failed.mock.calls).toEqual([["server"]]);
    expect(result.current.notice?.id).toBe("save-failed-server");
  });

  it("storage quota → cause browser", async () => {
    const failed = failures();
    trackingServer({ prefs: {} });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    try {
      const { result } = renderHook(() => ({ prefs: usePrefs(), notice: useSaveFailedNotice(() => {}) }));
      await waitFor(() => expect(failed).toHaveBeenCalledWith("browser"));
      expect(result.current.notice?.id).toBe("save-failed-browser");
    } finally {
      vi.mocked(Storage.prototype.setItem).mockRestore();
    }
  });

  it("successful save clears the notice", async () => {
    let patchStatus: number | undefined = 400;
    const api = trackingServer({ state: { j1: "saved" } }, { status: (m) => (m === "PATCH" ? patchStatus : undefined) });
    const { result } = renderHook(() => ({ tracked: useTracked({}), notice: useSaveFailedNotice(() => {}) }));
    await waitFor(() => expect(result.current.tracked.value).toEqual({ j1: "saved" }));
    act(() => result.current.tracked.setValue({ j1: "applied" }));
    await flushSaves();
    expect(result.current.notice?.id).toBe("save-failed-server");
    // Try again, with the server answering again: the change is sent and the notice goes.
    patchStatus = undefined;
    await act(async () => {
      await saveTrackingNow();
    });
    expect(api.file()).toEqual({ state: { j1: "applied" } });
    expect(result.current.notice).toBeNull();
  });

  it("falls back to PUT when PATCH is not supported", async () => {
    // An older server (after a rollback): no revisions, no PATCH.
    const api = trackingServer({ state: { j1: "saved" } }, { patch: false });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toEqual({ j1: "saved" }));
    act(() => result.current.setValue({ j1: "applied", j2: "saved" }));
    await flushSaves();
    expect(api.saves()).toEqual([{ method: "PUT", body: { state: { j1: "applied", j2: "saved" } } }]);
  });

  it("falls back to PUT when the server turns PATCH down", async () => {
    let patchStatus = 405;
    const api = trackingServer({ state: { j1: "saved" } }, { status: (m) => (m === "PATCH" ? patchStatus : undefined) });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toEqual({ j1: "saved" }));
    act(() => result.current.setValue({ j1: "applied" }));
    await flushSaves();
    expect(api.saves().map((c) => c.method)).toEqual(["PATCH", "PUT"]);
    patchStatus = 0;
    act(() => result.current.setValue({ j1: "offer" }));
    await flushSaves();
    expect(api.saves().map((c) => c.method)).toEqual(["PATCH", "PUT", "PUT"]);
    expect(api.file()).toEqual({ state: { j1: "offer" } });
  });

  it("trackingRev newer → pulls remote", async () => {
    const api = trackingServer({ state: { a: "saved" } });
    const { result } = renderHook(() => useTracked({}));
    await waitFor(() => expect(result.current.value).toEqual({ a: "saved" }));
    api.edit("state", "b", "applied");
    // The next health poll shows the new revision.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    await waitFor(() => expect(result.current.value).toEqual({ a: "saved", b: "applied" }));
    expect(api.saves()).toEqual([]);
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
    await flushSaves();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT" || init?.method === "PATCH")).toEqual([]);
  });

  it("doesn't upload over a file the server couldn't read (503)", async () => {
    const api = trackingServer({ state: { j1: "saved" } }, { status: (m) => (m === "GET" ? 503 : undefined) });
    const { result } = renderHook(() => useTracked({ j1: "old" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => result.current.setValue({ j1: "applied" }));
    await flushSaves();
    expect(api.saves()).toEqual([]);
  });
});

describe("useSavedAppearance", () => {
  it("brings back the theme saved in your RawJobs folder, at a new address with nothing in this browser", async () => {
    trackingServer({ appearance: { theme: "dark", density: "compact", maxAge: 180 } });
    renderHook(() => useSavedAppearance());
    await waitFor(() => expect(document.documentElement.dataset.theme).toMatch(/^dark/));
    expect(localStorage.getItem("rawjobs.theme")).toBe("dark");
    expect(localStorage.getItem("rawjobs.density")).toBe("compact");
    expect(localStorage.getItem("rawjobs.maxAge")).toBe("180");
  });

  it("uploads this browser's choices when the file has none yet", async () => {
    localStorage.setItem("rawjobs.theme", "light");
    const api = trackingServer({ state: {} });
    renderHook(() => useSavedAppearance());
    await waitFor(() => expect(reads(api)).toBe(1));
    await flushSaves();
    expect(api.file()).toMatchObject({ appearance: { theme: "light" } });
  });

  it("saves a theme picked in Settings, and System as no choice", async () => {
    const api = trackingServer({ appearance: {} });
    renderHook(() => useSavedAppearance());
    await waitFor(() => expect(reads(api)).toBe(1));
    act(() => setThemeChoice("dark"));
    await flushSaves();
    expect(api.file()).toMatchObject({ appearance: { theme: "dark" } });
    act(() => setThemeChoice("system"));
    await flushSaves();
    expect(api.file()).toMatchObject({ appearance: {} });
  });
});

describe("restoreFromDisk", () => {
  const settle = () => vi.advanceTimersByTimeAsync(500);

  it("puts what your RawJobs folder remembers in this browser, before the page draws", async () => {
    localStorage.setItem("rawjobs.checklist.dismissed", "true");
    localStorage.setItem("rawjobs.companiesTab", '"mine"');
    trackingServer({ browser: { "rawjobs.radar.seen": { latest: "2026-10-13T06:00:00Z" }, "rawjobs.scanScope": "all" } });
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
    const api = trackingServer({ state: {} });
    await restoreFromDisk();
    await settle();
    expect(api.file()).toMatchObject({ browser: { "rawjobs.scanAsk": false } });
    expect((api.file() as { browser: object }).browser).not.toHaveProperty("rawjobs.whyOpen");
  });

  it("saves a change to a kept key, and nothing for the others", async () => {
    const api = trackingServer({ browser: {} });
    await restoreFromDisk();
    save("rawjobs.companiesTab", "mine");
    await settle();
    expect(api.saves()).toEqual([]);
    save("rawjobs.notThisOne", ["acme"]);
    save("rawjobs.welcomeSeen", true);
    await settle();
    expect(api.saves().map((c) => c.body)).toEqual([{ changes: { browser: { set: { "rawjobs.notThisOne": ["acme"], "rawjobs.welcomeSeen": true }, del: [] } } }]);
  });

  it("unchanged browser copy is not uploaded", async () => {
    const api = trackingServer({ browser: { "rawjobs.scanScope": "all", "rawjobs.radar.v2": { sort: "new" } } });
    await restoreFromDisk();
    // A filter set and set back, or saved again as it was.
    save("rawjobs.scanScope", "mine");
    save("rawjobs.scanScope", "all");
    save("rawjobs.radar.v2", { sort: "new" });
    await settle();
    expect(api.saves()).toEqual([]);
  });

  it("saves nothing while the local API can't be reached, so an old copy never overwrites the file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await restoreFromDisk();
    save("rawjobs.scanScope", "all");
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT" || init?.method === "PATCH")).toEqual([]);
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
