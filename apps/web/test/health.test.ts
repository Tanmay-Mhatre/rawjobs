// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetHealthForTests, healthState, refreshHealth, requestFast, subscribeHealth } from "../src/lib/health";

let health: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.useFakeTimers();
  health = { ok: true, version: "1.0.0", scanning: false, background: false, dataVersion: "A" };
  fetchMock = vi.fn(async () => ({ json: async () => health }));
  vi.stubGlobal("fetch", fetchMock);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  __resetHealthForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("the shared health poller", () => {
  it("asks once per tick however many listen, and stops with the last one", async () => {
    const a = subscribeHealth(() => {});
    const b = subscribeHealth(() => {});
    await tick();
    expect(fetchMock).toHaveBeenCalledOnce();
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    a();
    b();
    await tick(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't ask while the tab is hidden, and asks at once when it's back", async () => {
    subscribeHealth(() => {});
    await tick();
    setVisibility("hidden");
    await tick(300_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    setVisibility("visible");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks every 5 s for a minute after a change, then backs off to 15, 30 and 60 s", async () => {
    subscribeHealth(() => {});
    await tick();
    await tick(60_000);
    const atIdle = fetchMock.mock.calls.length;
    expect(atIdle).toBe(13);
    await tick(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 1);
    await tick(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 2);
    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 3);
    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 4);
    // New results: often again.
    health = { ...health, dataVersion: "B" };
    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 5);
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(atIdle + 6);
  });

  it("asks every second while held, and every 2 s while a background scan runs", async () => {
    subscribeHealth(() => {});
    await tick();
    const release = requestFast();
    await tick(3000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    release();
    health = { ...health, background: true };
    refreshHealth();
    await tick();
    expect(healthState().health?.background).toBe(true);
    const n = fetchMock.mock.calls.length;
    await tick(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(n + 60);
  });

  it("says it's down when it doesn't answer, and asks every 3 s until it's back", async () => {
    subscribeHealth(() => {});
    await tick();
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refreshHealth();
    await tick();
    expect(healthState().down).toBe(true);
    expect(healthState().health?.version).toBe("1.0.0");
    const n = fetchMock.mock.calls.length;
    await tick(9000);
    expect(fetchMock).toHaveBeenCalledTimes(n + 3);
  });
});
