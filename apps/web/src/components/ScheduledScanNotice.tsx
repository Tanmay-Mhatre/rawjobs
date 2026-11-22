import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { scheduleStatus, type ScheduleStatus } from "../lib/automation";
import { SCAN_ENDED } from "../lib/scan";
import { load, save } from "../lib/storage";
import { failedRun, runLine } from "./ScheduledScans";
import { settingsHash } from "./settings/registry";
import { Button } from "./ui";

const SEEN_KEY = "rawjobs.scheduledNoticeSeen";

/** What the Radar says about scheduled scans, or null: the newest runs that didn't finish, or a schedule that's gone. */
export function scheduledNotice(s: ScheduleStatus | null): { key: string; title: string; detail: string; fix: boolean } | null {
  if (!s) return null;
  if (s.problem) return { key: `problem:${s.problem}`, title: "Scheduled scans aren't running.", detail: s.problem, fix: true };
  let n = 0;
  while (n < s.runs.length && failedRun(s.runs[n]!)) n++;
  const last = s.runs[0];
  if (!n || !last) return null;
  const at = new Date(last.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return {
    key: last.startedAt,
    title: n === 1 ? `Your ${at} scheduled scan didn't finish.` : `The last ${n} scheduled scans didn't finish.`,
    detail: runLine(last).replace(/^Didn't finish\. /, ""),
    fix: false,
  };
}

/**
 * On the Radar: a scheduled scan that didn't finish (maybe while the page was closed), why, and what
 * to do: Scan now, the details in Settings, or Dismiss (that run isn't mentioned again). Also a
 * schedule the computer lost. Read again whenever a scan ends.
 */
export function ScheduledScanNotice({ scanning, onScan }: { scanning: boolean; onScan: () => void }) {
  const [status, setStatus] = useState<ScheduleStatus | null>(null);
  const [seen, setSeen] = useState(() => load<string | null>(SEEN_KEY, null));
  const refresh = useCallback(() => void scheduleStatus().then((s) => setStatus(s.ok === false ? null : s)), []);
  useEffect(() => {
    refresh();
    window.addEventListener(SCAN_ENDED, refresh);
    return () => window.removeEventListener(SCAN_ENDED, refresh);
  }, [refresh]);
  const notice = scheduledNotice(status);
  if (!notice || scanning || seen === notice.key) return null;
  const dismiss = () => {
    save(SEEN_KEY, notice.key);
    setSeen(notice.key);
  };
  return (
    <div role="status" className="mb-4 flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-subtle p-3 type-small sm:flex-row sm:items-start">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text max-sm:hidden" aria-hidden />
      <p className="min-w-0 flex-1">
        <b className="font-semibold">{notice.title}</b> {notice.detail}
      </p>
      <div className="flex flex-wrap gap-2 self-start">
        {!notice.fix && (
          <Button size="sm" onClick={onScan}>
            Scan now
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            location.hash = settingsHash("scans");
          }}
        >
          {notice.fix ? "Fix the schedule" : "Details"}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
