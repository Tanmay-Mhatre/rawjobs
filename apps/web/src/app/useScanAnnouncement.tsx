import { useEffect, useRef } from "react";
import { toast } from "../components/Toast";
import type { ScanState } from "../lib/scan";

/** Set `.current` when setup saves and starts the first scan: a toast says how it went when it ends. */
export function useScanAnnouncement(scan: ScanState) {
  const announceScan = useRef(false);
  useEffect(() => {
    if (!announceScan.current || (scan.phase !== "done" && scan.phase !== "error")) return;
    announceScan.current = false;
    // A failed scan is explained inline by the scan progress bar; a toast only confirms what worked.
    if (scan.phase === "error") return;
    const m = scan.summary?.matches ?? 0;
    toast({
      message: m ? (
        <>
          Scan done: <b>{m.toLocaleString()}</b> matching {m === 1 ? "job" : "jobs"}.
        </>
      ) : (
        "Scan done. No matches yet: see why below."
      ),
    });
  }, [scan.phase, scan.summary]);

  return announceScan;
}
