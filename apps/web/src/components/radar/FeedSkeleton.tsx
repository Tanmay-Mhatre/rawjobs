/**
 * First load of the feed (design/components/Loading): skeleton rows shaped like real rows, inside the
 * feed panel, marked busy. No spinner, no "Loading…" text on its own. The shimmer stops under reduced motion.
 */
export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  const widths = [
    ["55%", "35%"],
    ["48%", "30%"],
    ["62%", "40%"],
    ["44%", "28%"],
    ["58%", "33%"],
    ["50%", "38%"],
  ];
  return (
    <div className="rj-panel grid gap-4 p-4" aria-busy="true" aria-label="Loading jobs" role="status">
      {Array.from({ length: rows }, (_, i) => {
        const [a, b] = widths[i % widths.length]!;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
          <div key={i} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-4">
            <span className="rj-skel h-7" />
            <span className="grid gap-2">
              <span className="rj-skel" style={{ width: a }} />
              <span className="rj-skel" style={{ width: b }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
