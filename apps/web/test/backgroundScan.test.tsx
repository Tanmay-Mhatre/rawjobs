// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackgroundScan } from "../src/lib/backgroundScan";
import type { DataMeta } from "../src/lib/data";
import { __resetHealthForTests } from "../src/lib/health";

type Health = { scanning?: boolean; background?: boolean; dataVersion?: string | null };
let health: Health;

beforeEach(() => {
  vi.useFakeTimers();
  health = { scanning: false, background: false, dataVersion: "A" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ ok: true, ...health }) })),
  );
});
afterEach(() => {
  cleanup();
  __resetHealthForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const meta = (generatedAt: string, newMatches = 0) => ({ generatedAt, runs: [{ newMatches }] }) as unknown as DataMeta;
/** Lets the poll's fetch and the reload settle, then moves on to the next poll. */
const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function setup(initial: { loaded: string | null | undefined; paused?: boolean }) {
  let loaded = initial.loaded;
  const reload = vi.fn(async () => {
    loaded = health.dataVersion ?? null;
    return meta(loaded ?? "", 3);
  });
  const onFinished = vi.fn();
  const hook = renderHook((p: { paused: boolean }) => useBackgroundScan({ loaded, paused: p.paused, reload, onFinished }), { initialProps: { paused: !!initial.paused } });
  return { hook, reload, onFinished };
}

describe("useBackgroundScan", () => {
  it("leaves the page alone while its data is current", async () => {
    const { reload } = setup({ loaded: "A" });
    await tick();
    await tick(15_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows a scheduled scan while it runs, then reloads once and announces it when it ends", async () => {
    const { hook, reload, onFinished } = setup({ loaded: "A" });
    health = { background: true, dataVersion: "A" };
    await tick();
    expect(hook.result.current.running).toBe(true);
    // Partial results written mid-scan wait for the scan to end.
    health = { background: true, dataVersion: "B" };
    await tick(5000);
    expect(reload).not.toHaveBeenCalled();
    health = { background: false, dataVersion: "B" };
    await tick(5000);
    hook.rerender({ paused: false });
    expect(hook.result.current.running).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(onFinished).toHaveBeenCalledOnce();
    await tick(5000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("shows the first results when there were none", async () => {
    const { reload } = setup({ loaded: null });
    await tick();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves a scan the page runs itself, or a server one, to reload by itself", async () => {
    const { hook, reload } = setup({ loaded: "A", paused: true });
    health = { dataVersion: "B" };
    await tick();
    expect(reload).not.toHaveBeenCalled();
    hook.rerender({ paused: false });
    health = { scanning: true, dataVersion: "B" };
    await tick(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads without a toast when the new results came from a scan it didn't see running", async () => {
    const { reload, onFinished } = setup({ loaded: "A" });
    health = { dataVersion: "B" };
    await tick();
    expect(reload).toHaveBeenCalledOnce();
    expect(onFinished).not.toHaveBeenCalled();
  });
});
