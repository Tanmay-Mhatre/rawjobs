import { toast } from "../components/Toast";
import type { DataMeta } from "../lib/data";

/** A scheduled scan ended while the page was open and its results are now on screen: say what it found. */
export function announceBackgroundScan(meta: DataMeta) {
  const n = meta.runs[0]?.newMatches ?? 0;
  toast({
    message: n ? (
      <>
        Scheduled scan done: <b>{n.toLocaleString()}</b> new {n === 1 ? "job" : "jobs"}.
      </>
    ) : (
      "Scheduled scan done. No new jobs this time."
    ),
  });
}
