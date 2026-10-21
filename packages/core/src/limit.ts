/**
 * Runs tasks at most `max` at a time, the rest waiting their turn in the order they came. Without a
 * max (undefined, 0 or Infinity) every task runs at once.
 */
export function limiter(max: number | undefined): <T>(task: () => Promise<T>) => Promise<T> {
  if (!max || !Number.isFinite(max)) return (task) => task();
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (running >= max) await new Promise<void>((go) => waiting.push(go));
    else running++;
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next task, or give it back.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
