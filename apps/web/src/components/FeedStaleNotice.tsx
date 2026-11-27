import { TriangleAlert } from "lucide-react";
import { PRIORITY, type Notice } from "../app/notices";
import { aboutRange } from "../lib/scan";
import { useScanSelector } from "../lib/scanStore";
import { Button } from "./primitives";

/** "4 days old"; "missing" without a feed. */
const age = (days: number | null | undefined) => (days === null || days === undefined ? null : `${Math.max(1, Math.floor(days))} day${Math.floor(days) === 1 ? "" : "s"} old`);

/**
 * Scan now with a shared job feed too old to pick companies (over 3 days): this scan checks every
 * company itself. Said up front, with the honest time, and the quick scan of your own companies
 * offered instead. Matches still stream in either way. Stays until the scan ends.
 */
export function useFeedStaleNotice({ enabled, onOnlyMine }: { enabled: boolean; onOnlyMine: () => void }): Notice | null {
  const on = useScanSelector((s) => s.phase === "running" && !!s.fallback && !s.stopping);
  const feedAgeDays = useScanSelector((s) => s.feedAgeDays);
  const seconds = useScanSelector((s) => s.seconds);
  if (!enabled || !on) return null;
  return { id: "feed-stale", priority: PRIORITY.feedStale, tone: "warn", render: () => <FeedStaleNotice feedAgeDays={feedAgeDays} seconds={seconds} onOnlyMine={onOnlyMine} /> };
}

function FeedStaleNotice({ feedAgeDays, seconds, onOnlyMine }: { feedAgeDays: number | null | undefined; seconds: number | undefined; onOnlyMine: () => void }) {
  const old = age(feedAgeDays);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-subtle p-3 type-small sm:flex-row sm:items-start">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text max-sm:hidden" aria-hidden />
      <p className="min-w-0 flex-1">
        <b className="font-semibold">{old ? `The shared job feed is ${old}.` : "The shared job feed isn't available."}</b> So this scan checks every company itself
        {seconds ? `: ${aboutRange(seconds)}` : ""}. New matches show up as they're found.
      </p>
      <Button size="sm" onClick={onOnlyMine} className="self-start">
        Only my companies
      </Button>
    </div>
  );
}
