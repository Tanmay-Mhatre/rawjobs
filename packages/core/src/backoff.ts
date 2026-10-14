/**
 * Doubling with a cap: base, 2·base, 4·base… up to `cap`, for the nth failure in a row (from 1; 0
 * below that). The directory's retries (days, up to 30) and board health's rests (hours, up to 24)
 * both use it.
 */
export function backoff(n: number, base: number, cap: number): number {
  return n < 1 ? 0 : Math.min(base * 2 ** (n - 1), cap);
}
