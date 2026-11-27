// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "../src/components/Toast";
import { useScan } from "../src/lib/scan";
import { resetScanStore, useScanState } from "../src/lib/scanStore";

vi.mock("../src/components/Toast", () => ({ toast: vi.fn() }));

/** GET /api/run answers with this scan: its headers, then its events, one line each. */
function serve(run: { origin?: string; scope?: string; events: object[] } | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== "/api/run" || !run) return new Response(null, { status: 204 });
      const headers: Record<string, string> = { "x-rawjobs-scope": run.scope ?? "mine" };
      if (run.origin) headers["x-rawjobs-origin"] = run.origin;
      return new Response(run.events.map((e) => `${JSON.stringify(e)}\n`).join(""), { status: 200, headers });
    }),
  );
}

/** The hook, with the scan it shows (from the scan store). */
const useScanAndState = (onFinished: () => void) => ({ ...useScan(onFinished), scan: useScanState() });

afterEach(() => {
  cleanup();
  resetScanStore();
  vi.unstubAllGlobals();
  vi.mocked(toast).mockClear();
});

const done = (newMatches: number, extra: object = {}) => ({
  type: "done",
  stage: "quick",
  jobsFound: 0,
  matches: 0,
  strong: 0,
  newMatches,
  failed: 0,
  checked: 0,
  stopped: false,
  moves: [],
  ...extra,
});

describe("following a scan this page didn't start", () => {
  it("shows a scheduled scan's progress like its own, then says what it found once", async () => {
    serve({ origin: "scheduled", events: [{ type: "start", companies: ["Acme"], total: 4, stage: "quick" }, { type: "progress", done: 2 }, done(3)] });
    const onFinished = vi.fn();
    const { result } = renderHook(() => useScanAndState(onFinished));
    await waitFor(() => expect(result.current.scan.phase).toBe("done"));
    expect(result.current.scan.origin).toBe("scheduled");
    expect(result.current.scan.total).toBe(4);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Scheduled scan done: 3 new jobs.");
  });

  it("says when it was stopped, or didn't finish", async () => {
    serve({ origin: "scheduled", events: [{ type: "start", companies: [], total: 4, stage: "quick" }, done(0, { stopped: true })] });
    const stopped = renderHook(() => useScanAndState(() => {}));
    await waitFor(() => expect(stopped.result.current.scan.phase).toBe("done"));
    expect(vi.mocked(toast).mock.calls[0]![0].message).toMatch(/^Scheduled scan stopped\./);
    cleanup();
    vi.mocked(toast).mockClear();

    serve({ origin: "terminal", events: [{ type: "error", message: "The data folder is full." }] });
    const failed = renderHook(() => useScanAndState(() => {}));
    await waitFor(() => expect(failed.result.current.scan.phase).toBe("error"));
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Scan didn't finish: The data folder is full.");
  });

  it("picks up its own scan after a reload without a second 'done' message", async () => {
    serve({ events: [{ type: "start", companies: [], total: 1, stage: "quick" }, done(1)] });
    const { result } = renderHook(() => useScanAndState(() => {}));
    await waitFor(() => expect(result.current.scan.phase).toBe("done"));
    expect(result.current.scan.origin).toBe("page");
    expect(toast).not.toHaveBeenCalled();
  });

  it("follows one that starts later, when health says it's running", async () => {
    serve(null);
    const { result } = renderHook(() => useScanAndState(() => {}));
    await act(async () => {});
    expect(result.current.scan.phase).toBe("idle");
    serve({ origin: "scheduled", events: [{ type: "start", companies: [], total: 2, stage: "quick" }, done(0)] });
    act(() => result.current.follow());
    await waitFor(() => expect(result.current.scan.phase).toBe("done"));
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Scheduled scan done. No new jobs this time.");
  });
});
