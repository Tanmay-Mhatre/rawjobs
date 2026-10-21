import { Users, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { isAgencyPosting } from "../../lib/agency";
import { canRunLocally, type Job } from "../../lib/data";
import { companyName } from "../../lib/format";
import { useNetwork } from "../../lib/network";
import { load, save } from "../../lib/storage";
import { toast } from "../Toast";
import { Button, IconButton } from "../primitives";
import { ConnectLinkedIn, WatchLine } from "./ConnectLinkedIn";

/** Closed once, the banner stays closed on every job (kept on disk: tracking.ts KEPT_ON_DISK). */
export const BANNER_DISMISSED_KEY = "rawjobs.linkedinBanner.dismissed";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const isDismissed = () => !!load<boolean | null>(BANNER_DISMISSED_KEY, null);
const setDismissed = (on: boolean) => {
  save(BANNER_DISMISSED_KEY, on || null);
  for (const fn of listeners) fn();
};

/** Whether you closed the LinkedIn banner (the people section then offers Connect LinkedIn itself). */
export function useBannerDismissed(): boolean {
  return useSyncExternalStore(subscribe, isDismissed, () => false);
}

/**
 * Top of a job: "See who you know at {Company}", until your LinkedIn connections are imported or you
 * close it. Import opens the same dialog as Settings › LinkedIn connections.
 */
export function ConnectBanner({ job, notInterested }: { job: Job; notInterested?: boolean }) {
  const network = useNetwork();
  const dismissed = useBannerDismissed();
  const [connecting, setConnecting] = useState(false);
  const status = network?.state === "ready" ? network.value.status : undefined;
  // The dialog stays up after the import, while the banner itself goes.
  const show = canRunLocally && !!status && !status.connected && !status.newer && !dismissed && !job.estimated && !notInterested && !isAgencyPosting(job);
  const close = () => {
    setDismissed(true);
    toast({
      message: "Hidden. Import your connections any time in Settings › LinkedIn connections.",
      actionLabel: "Undo",
      onAction: () => setDismissed(false),
    });
  };
  return (
    <>
      {show && (
        <aside aria-labelledby={`connect-${job.id}`} className="flex items-start gap-3 rounded-md border border-line border-l-[3px] border-l-ink bg-inset p-3">
          <Users className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid gap-0.5">
              <h3 id={`connect-${job.id}`} className="font-medium text-ink">
                See who you know at {companyName(job.company)}
              </h3>
              {status?.watch ? (
                <WatchLine watch={status.watch} />
              ) : (
                <p className="type-small text-muted">
                  Import your LinkedIn connections to see friends who work here. RawJobs reads LinkedIn's own export on this computer: no LinkedIn login, nothing is sent anywhere.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => setConnecting(true)}>
                Import connections
              </Button>
              <Button size="sm" variant="quiet" onClick={close}>
                Not now
              </Button>
            </div>
          </div>
          <IconButton label="Close" size="sm" onClick={close} className="-mt-1 -mr-1 shrink-0">
            <X className="rj-icon" />
          </IconButton>
        </aside>
      )}
      {canRunLocally && <ConnectLinkedIn open={connecting} onClose={() => setConnecting(false)} />}
    </>
  );
}
