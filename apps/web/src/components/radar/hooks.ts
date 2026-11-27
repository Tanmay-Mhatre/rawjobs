import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

/** The time freshness is worked out at, moved on every hour: often enough to stay right, never while you read. */
export function useHourlyNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3_600_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function useIsWide() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * One window keydown listener for the component's life, calling the latest handler (which closes
 * over props and state that change on every render).
 */
export function useLatestKeydown(handler: (e: KeyboardEvent) => void) {
  const onKey = useEffectEvent(handler);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

/**
 * A function that stays the same for the component's life and calls the latest `fn`: for handlers passed
 * to memo children (rows, the details panel), so new closures don't make them render again. The latest
 * `fn` is kept after each render (not during it), so call it from events, not while rendering.
 */
export function useStableHandler<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
