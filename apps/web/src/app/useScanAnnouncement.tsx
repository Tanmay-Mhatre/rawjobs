import { useEffect, useRef } from "react";
import { toast } from "../components/Toast";
import { useScanSelector } from "../lib/scanStore";

/** Set `.current` when setup saves and starts the first scan: a toast says how it went when it ends. */
export function useScanAnnouncement() {
  const announceScan = useRef(false);
  const phase = useScanSelector((s) => s.phase);
  const summary = useScanSelector((s) => s.summary);
  useEffect(() => {
    if (!announceScan.current || (phase !== "done" && phase !== "error")) return;
    announceScan.current = false;
    // A failed scan is explained inline by the scan progress bar; a toast only confirms what worked.
    if (phase === "error") return;
    const m = summary?.matches ?? 0;
    toast({
      message: m ? (
        <>
          Scan done: <b>{m.toLocaleString()}</b> matching {m === 1 ? "job" : "jobs"}.
        </>
      ) : (
        "Scan done. No matches yet: see why below."
      ),
    });
  }, [phase, summary]);

  return announceScan;
}
