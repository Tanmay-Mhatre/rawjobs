import { afterEach, describe, expect, it, vi } from "vitest";
import { awakeTimeout } from "../src/clock";

describe("awakeTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("fires after the awake time, not at the first tick after a long sleep", () => {
    vi.useFakeTimers();
    let wall = 0;
    let fired = false;
    awakeTimeout(60_000, () => (fired = true), { tickMs: 10_000, now: () => wall });
    const tick = (wallMs: number) => {
      wall += wallMs;
      vi.advanceTimersByTime(10_000);
    };
    tick(10_000);
    tick(10_000);
    // Asleep for 6 days: one tick, 6 days later on the wall clock, counts as one tick of awake time.
    tick(6 * 86_400_000);
    expect(fired).toBe(false);
    tick(10_000);
    tick(10_000);
    expect(fired).toBe(false);
    tick(10_000);
    expect(fired).toBe(true);
  });

  it("can be cancelled", () => {
    vi.useFakeTimers();
    let fired = false;
    const cancel = awakeTimeout(20_000, () => (fired = true), { tickMs: 10_000 });
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(fired).toBe(false);
  });
});
