import { LoaderCircle, Square } from "lucide-react";
import { useState } from "react";
import { aboutTime, type ScanProgress } from "../lib/scan";
import { stopScan } from "../lib/setup";
import { Button } from "./primitives";

/**
 * An update waiting for a scan: how far along the scan is and about how long is left (a page,
 * scheduled or terminal scan alike), and a way to stop it and update now.
 */

/** "Update after scan · 42%". */
export const waitLabel = (p: ScanProgress | null) => `Update after scan${p?.percent != null ? ` · ${p.percent}%` : ""}`;

/** "The scheduled scan has about 6 min left. RawJobs updates as soon as it ends." */
export function waitLine(p: ScanProgress | null): string {
  if (!p) return "A scan is running: RawJobs updates as soon as it's done.";
  const who = p.origin === "scheduled" ? "The scheduled scan" : "The scan";
  return `${who} ${p.secondsLeft ? `has ${aboutTime(p.secondsLeft)} left` : "is running"}. RawJobs updates as soon as it ends.`;
}

/** Stop the scan (what it checked is kept; the next scan carries on) so the waiting update installs within seconds. */
export function StopScanAndUpdate({ className }: { className?: string }) {
  const [stopping, setStopping] = useState(false);
  return (
    <Button
      size="sm"
      className={className}
      disabled={stopping}
      onClick={() => {
        setStopping(true);
        void stopScan();
      }}
    >
      {stopping ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Square className="size-3 fill-current" aria-hidden />}
      {stopping ? "Stopping the scan…" : "Stop the scan and update now"}
    </Button>
  );
}
