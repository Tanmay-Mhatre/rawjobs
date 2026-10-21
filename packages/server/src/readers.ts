/**
 * Answers to read-only GETs, kept for a while so a page that asks often doesn't redo the work (or
 * start a process) each time. A read that fails isn't kept. `clear` forgets them all: after
 * anything that may change them (a save, a scan that ended).
 */
export function createReaders(now = () => Date.now()) {
  const kept = new Map<string, { until: number; value: Promise<unknown> }>();

  /** `fn`'s answer, read again after `ttlMs` (Infinity: until cleared; put what it depends on in `key`). */
  function memo<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<T> {
    const hit = kept.get(key);
    if (hit && hit.until > now()) return hit.value as Promise<T>;
    const value = Promise.resolve().then(fn);
    kept.set(key, { until: now() + ttlMs, value });
    value.catch(() => {
      if (kept.get(key)?.value === value) kept.delete(key);
    });
    return value;
  }

  return { memo, clear: () => kept.clear() };
}
