import { TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button, Card } from "../components/ui";
import { toast } from "../components/Toast";
import { onSaved, onSaveFailed, type SaveCause } from "../lib/storage";
import { saveTrackingNow } from "../lib/tracking";
import { type Notice, PRIORITY } from "./notices";

/** The causes that get a notice. Offline has none: the Reconnecting notice already says changes are kept. */
type Problem = Exclude<SaveCause, "offline">;

let problem: { cause: Problem; at: number } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};

// Listen from the start, so a save that fails before the notice first draws is still shown.
onSaveFailed((cause) => {
  if (cause === "offline") return;
  problem = { cause, at: Date.now() };
  changed();
});
onSaved((where) => {
  // A save to your RawJobs folder settles a server problem or a conflict; one in this browser, a full browser.
  if (!problem || (where === "browser") !== (problem.cause === "browser")) return;
  problem = null;
  changed();
  toast({ message: "Tracking saved." });
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Tests: forget a problem left by an earlier test. */
export function resetSaveProblem() {
  problem = null;
  changed();
}

/**
 * Your tracking couldn't be saved (P3): why, and what to do. It stays until a save works.
 * `exportTracking` downloads your tracking (Settings' Export), for a browser whose storage is full.
 */
export function useSaveFailedNotice(exportTracking: () => void): Notice | null {
  const p = useSyncExternalStore(subscribe, () => problem);
  if (!p) return null;
  return {
    id: `save-failed-${p.cause}`,
    priority: PRIORITY.saveFailed,
    tone: p.cause === "browser" ? "warn" : "danger",
    at: p.at,
    render: () => <SaveFailed cause={p.cause} onExport={exportTracking} />,
  };
}

const COPY: Record<Problem, string> = {
  server: "Couldn't save your tracking to your RawJobs folder. It's kept in this browser for now.",
  browser: "This browser couldn't store your tracking because its storage is full. It's still saved in your RawJobs folder.",
  conflict: "Your tracking changed in another window. Reload to see both.",
};

function SaveFailed({ cause, onExport }: { cause: Problem; onExport: () => void }) {
  return (
    <Card className="px-4 py-2.5 type-small">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TriangleAlert className={`size-4 shrink-0 max-sm:hidden ${cause === "browser" ? "text-warning-text" : "text-danger-text"}`} aria-hidden />
        <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">{COPY[cause]}</span>
        {cause === "server" ? (
          <Button size="sm" onClick={() => void saveTrackingNow()}>
            Try again
          </Button>
        ) : cause === "browser" ? (
          <Button size="sm" onClick={onExport}>
            Export tracking
          </Button>
        ) : (
          <Button size="sm" onClick={() => location.reload()}>
            Reload
          </Button>
        )}
      </p>
    </Card>
  );
}
