import { TriangleAlert } from "lucide-react";
import { aboutRange, type ScanState } from "../lib/scan";
import { Button } from "./ui";

/** "4 days old"; "missing" without a feed. */
const age = (days: number | null | undefined) => (days === null || days === undefined ? null : `${Math.max(1, Math.floor(days))} day${Math.floor(days) === 1 ? "" : "s"} old`);

/**
 * Scan now with a shared job feed too old to pick companies (over 3 days): this scan checks every
 * company itself. Said up front, with the honest time, and the quick scan of your own companies
 * offered instead. Matches still stream in either way.
 */
export function FeedStaleNotice({ scan, onOnlyMine }: { scan: ScanState; onOnlyMine: () => void }) {
  if (scan.phase !== "running" || !scan.fallback || scan.stopping) return null;
  const old = age(scan.feedAgeDays);
  return (
    <div role="status" className="mb-4 flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-subtle p-3 type-small sm:flex-row sm:items-start">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text max-sm:hidden" aria-hidden />
      <p className="min-w-0 flex-1">
        <b className="font-semibold">{old ? `The shared job feed is ${old}.` : "The shared job feed isn't available."}</b> So this scan checks every company itself
        {scan.seconds ? `: ${aboutRange(scan.seconds)}` : ""}. New matches show up as they're found.
      </p>
      <Button size="sm" onClick={onOnlyMine} className="self-start">
        Only my companies
      </Button>
    </div>
  );
}
