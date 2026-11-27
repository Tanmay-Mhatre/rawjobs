/**
 * The running scan's lines, kept for a tab that starts following it later, in a bounded amount of
 * memory. A long scan sends a `progress` line every 25 companies (or every 2 s), tens of thousands
 * over an All-companies check; each one carries the running totals (`done`, per hiring system, per
 * source), so only the last ones matter and the oldest are dropped once `keep` of them are held.
 *
 * Every other line is kept whole: the steps (`sync`, `synced`, `start`, `background`, `done`,
 * `notified`, `error`) and the lines whose effect on the page adds up rather than being replaced:
 * `company` (one for each of your companies and each other company that matched or failed: the
 * page sums found and failed and lists your companies' results from them) and `jobs` (the live matches, sent during Scan now only).
 * Lines are replayed in the order they came.
 */
export function scanLines(keep = 1000) {
  /** Kept lines with their place in the stream. */
  const kept: { n: number; line: string }[] = [];
  /** The last `keep` progress lines, oldest at `start` once it's full. */
  const ring: { n: number; line: string }[] = [];
  let start = 0;
  let count = 0;

  function push(line: string) {
    const entry = { n: count++, line };
    if (!line.startsWith('{"type":"progress"')) {
      kept.push(entry);
      return;
    }
    if (ring.length < keep) ring.push(entry);
    else {
      ring[start] = entry;
      start = (start + 1) % keep;
    }
  }

  /** Every line to replay, in the order it came. */
  function replay(): string[] {
    const tail = [...ring.slice(start), ...ring.slice(0, start)];
    const out: string[] = [];
    let i = 0;
    let j = 0;
    while (i < kept.length || j < tail.length) {
      if (j >= tail.length || (i < kept.length && kept[i]!.n < tail[j]!.n)) out.push(kept[i++]!.line);
      else out.push(tail[j++]!.line);
    }
    return out;
  }

  return { push, replay, size: () => kept.length + ring.length };
}

export type ScanLines = ReturnType<typeof scanLines>;
