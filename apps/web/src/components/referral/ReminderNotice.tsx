import { Users } from "lucide-react";
import { useState } from "react";
import { PRIORITY, type Notice } from "../../app/notices";
import { canRunLocally } from "../../lib/data";
import { cancelReminder, setReminder, useNetwork } from "../../lib/network";
import { Button } from "../primitives";
import { toast } from "../Toast";
import { ConnectLinkedIn } from "./ConnectLinkedIn";

/** The snooze: "Remind me tomorrow". */
export const SNOOZE_HOURS = 24;

/**
 * Top of the Radar once "Remind me in 48 hours" comes due and the file isn't added yet. It stays until
 * you add the file, snooze it or dismiss it. Add the file's window stays open after it goes.
 */
export function useReminderNotice(enabled = true): Notice | null {
  const network = useNetwork();
  const [connecting, setConnecting] = useState(false);
  if (!canRunLocally || !enabled) return null;
  const due = network?.state === "ready" && !!network.value.reminder?.due;
  if (!due && !connecting) return null;
  const snooze = async () => {
    if (!(await setReminder(SNOOZE_HOURS))) toast({ message: "Couldn't set the reminder. Check that RawJobs is running, then try again." });
  };
  return {
    id: "linkedin-reminder",
    priority: PRIORITY.reminder,
    tone: "info",
    render: due
      ? () => (
          <aside aria-labelledby="linkedin-reminder" className="flex items-start gap-3 rounded-md border border-line border-l-[3px] border-l-ink bg-inset p-3">
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
        )
      : null,
    dialog: <ConnectLinkedIn open={connecting} onClose={() => setConnecting(false)} />,
  };
}

/** The reminder on its own, outside the Radar's NoticeSlot (tests). */
export function ReminderNotice() {
  const n = useReminderNotice();
  return n ? (
    <>
      {n.render?.()}
      {n.dialog}
    </>
  ) : null;
}
