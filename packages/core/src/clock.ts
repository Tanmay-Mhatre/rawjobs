/**
 * Timers that leave out time the computer spent asleep. Node's timers run on a clock that stops
 * while the computer sleeps, so a 10-minute timeout can fire the moment it wakes, hours later on the
 * wall clock, for a run that had only seconds of awake time. These count only the awake time.
 */

export type ClockOptions = { tickMs?: number; now?: () => number };

/**
 * Call `cb` once `ms` of awake time has passed. Checked every `tickMs`: a tick that came much later
 * than due (over twice `tickMs` on the wall clock) spanned sleep and adds only `tickMs`. Returns a cancel function.
 */
export function awakeTimeout(ms: number, cb: () => void, o: ClockOptions = {}): () => void {
  const tickMs = o.tickMs ?? Math.min(10_000, Math.max(ms, 1));
  const now = o.now ?? Date.now;
  let awake = 0;
  let last = now();
  const timer = setInterval(() => {
    const t = now();
    const gap = t - last;
    last = t;
    awake += gap > 2 * tickMs ? tickMs : gap;
    if (awake >= ms) {
      clearInterval(timer);
      cb();
    }
  }, tickMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
