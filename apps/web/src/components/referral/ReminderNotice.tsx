import { Users } from "lucide-react";
import { useState } from "react";
import { canRunLocally } from "../../lib/data";
import { cancelReminder, setReminder, useNetwork } from "../../lib/network";
import { Button } from "../primitives";
import { toast } from "../Toast";
import { ConnectLinkedIn } from "./ConnectLinkedIn";

/** The snooze: "Remind me tomorrow". */
export const SNOOZE_HOURS = 24;

/**
 * Top of the Radar once "Remind me in 48 hours" comes due and the file isn't added yet. It stays until
 * you add the file, snooze it or dismiss it.
 */
export function ReminderNotice() {
  const network = useNetwork();
  const [connecting, setConnecting] = useState(false);
  if (!canRunLocally) return null;
  const due = network?.state === "ready" && !!network.value.reminder?.due;
  const snooze = async () => {
    if (!(await setReminder(SNOOZE_HOURS))) toast({ message: "Couldn't set the reminder. Check that RawJobs is running, then try again." });
  };
  return (
    <>
      {due && (
        <aside aria-labelledby="linkedin-reminder" className="mb-4 flex items-start gap-3 rounded-md border border-line border-l-[3px] border-l-ink bg-inset p-3">
          <Users className="mt-0.5 size-4 shrink-0 text-muted max-sm:hidden" aria-hidden />
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="grid gap-0.5">
              <h2 id="linkedin-reminder" className="font-medium text-ink">
                Your LinkedIn file should be ready
              </h2>
              <p className="type-small text-muted">Add it to see who you know at your jobs.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => setConnecting(true)}>
                Add the file
              </Button>
              <Button size="sm" onClick={() => void snooze()}>
                Remind me tomorrow
              </Button>
              <Button size="sm" variant="quiet" onClick={() => void cancelReminder()}>
                Dismiss
              </Button>
            </div>
          </div>
        </aside>
      )}
      <ConnectLinkedIn open={connecting} onClose={() => setConnecting(false)} />
    </>
  );
}
